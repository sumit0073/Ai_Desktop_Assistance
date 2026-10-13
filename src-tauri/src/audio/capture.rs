use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;

use super::resample::{resample_mono_i16, to_mono_i16};
use super::segmenter::{FinalizedSegment, SpeechSegmenter};
use super::types::{AudioSourceKind, SourceCaptureStatus};
use super::vad::WebRtcVoiceDetector;
use super::validate::validate_segment;
use super::wav::segment_to_wav_bytes;

pub type SegmentSink = Arc<dyn Fn(FinalizedSegment) + Send + Sync>;

struct StreamGuard {
    _stream: Stream,
}

/// One independent capture lane (microphone or meeting loopback).
pub struct CaptureLane {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    /// Keeps the cpal stream alive on the audio thread via channel... actually
    /// we store the stream on the join thread. Here we only track status.
    status: Arc<Mutex<SourceCaptureStatus>>,
}

impl CaptureLane {
    pub fn status(&self) -> SourceCaptureStatus {
        self.status.lock().clone()
    }

    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.join.take() {
            let _ = handle.join();
        }
    }
}

fn set_status(status: &Arc<Mutex<SourceCaptureStatus>>, next: SourceCaptureStatus) {
    *status.lock() = next;
}

/// Start microphone capture (cpal default input) with VAD segmentation.
pub fn start_microphone(sink: SegmentSink) -> Result<CaptureLane, SourceCaptureStatus> {
    start_lane(AudioSourceKind::Microphone, false, sink)
}

/// Start meeting / system-audio capture.
/// - Windows: WASAPI loopback via cpal input stream on the default output device.
/// - macOS / others: unavailable (ScreenCaptureKit not wired yet) — explicit status.
pub fn start_meeting(sink: SegmentSink) -> Result<CaptureLane, SourceCaptureStatus> {
    #[cfg(target_os = "windows")]
    {
        start_lane(AudioSourceKind::Meeting, true, sink)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = sink;
        Err(SourceCaptureStatus::Unavailable {
            reason: "Native meeting/system-audio capture is not yet available on this OS. On macOS, ScreenCaptureKit integration is required (permission + native bridge). Windows WASAPI loopback is supported."
                .into(),
        })
    }
}

fn start_lane(
    kind: AudioSourceKind,
    loopback: bool,
    sink: SegmentSink,
) -> Result<CaptureLane, SourceCaptureStatus> {
    let host = cpal::default_host();
    let device = if loopback {
        host.default_output_device().ok_or_else(|| {
            SourceCaptureStatus::Unavailable {
                reason: "No default output device for meeting loopback.".into(),
            }
        })?
    } else {
        host.default_input_device().ok_or_else(|| {
            SourceCaptureStatus::PermissionDenied {
                reason: "No microphone found, or microphone permission denied.".into(),
            }
        })?
    };

    let config = if loopback {
        device
            .default_output_config()
            .map_err(|e| SourceCaptureStatus::Unavailable {
                reason: format!("Output config unavailable: {e}"),
            })?
    } else {
        device
            .default_input_config()
            .map_err(|e| SourceCaptureStatus::PermissionDenied {
                reason: format!("Microphone config unavailable: {e}"),
            })?
    };

    let sample_format = config.sample_format();
    let stream_config: StreamConfig = config.into();
    let channels = stream_config.channels as usize;
    let sample_rate = stream_config.sample_rate.0;

    let stop = Arc::new(AtomicBool::new(false));
    let status = Arc::new(Mutex::new(SourceCaptureStatus::Active));
    let stop_thread = Arc::clone(&stop);
    let status_thread = Arc::clone(&status);

    let join = thread::Builder::new()
        .name(format!("seecog-audio-{}", kind.as_str()))
        .spawn(move || {
            let detector = match WebRtcVoiceDetector::new() {
                Ok(d) => d,
                Err(err) => {
                    set_status(
                        &status_thread,
                        SourceCaptureStatus::Unavailable { reason: err },
                    );
                    return;
                }
            };
            let segmenter = Arc::new(Mutex::new(SpeechSegmenter::new(kind, detector)));
            let last_fp = Arc::new(Mutex::new(None::<String>));

            let err_status = Arc::clone(&status_thread);
            let err_fn = move |err: cpal::StreamError| {
                set_status(
                    &err_status,
                    SourceCaptureStatus::Unavailable {
                        reason: format!("Audio device error: {err}"),
                    },
                );
            };

            let build_result = match sample_format {
                SampleFormat::F32 => build_f32_stream(
                    &device,
                    &stream_config,
                    channels,
                    sample_rate,
                    Arc::clone(&segmenter),
                    Arc::clone(&last_fp),
                    Arc::clone(&sink),
                    err_fn,
                ),
                SampleFormat::I16 => build_i16_stream(
                    &device,
                    &stream_config,
                    channels,
                    sample_rate,
                    Arc::clone(&segmenter),
                    Arc::clone(&last_fp),
                    Arc::clone(&sink),
                    err_fn,
                ),
                other => {
                    set_status(
                        &status_thread,
                        SourceCaptureStatus::Unavailable {
                            reason: format!("Unsupported sample format: {other:?}"),
                        },
                    );
                    return;
                }
            };

            let stream = match build_result {
                Ok(s) => s,
                Err(err) => {
                    set_status(&status_thread, err);
                    return;
                }
            };

            if let Err(e) = stream.play() {
                set_status(
                    &status_thread,
                    SourceCaptureStatus::Unavailable {
                        reason: format!("Failed to start audio stream: {e}"),
                    },
                );
                return;
            }

            let _guard = StreamGuard { _stream: stream };

            while !stop_thread.load(Ordering::SeqCst) {
                thread::sleep(std::time::Duration::from_millis(50));
            }

            if let Some(seg) = segmenter.lock().flush() {
                emit_if_valid(&seg, &last_fp, &sink);
            }
            set_status(&status_thread, SourceCaptureStatus::Stopped);
        })
        .map_err(|e| SourceCaptureStatus::Unavailable {
            reason: format!("Failed to spawn audio thread: {e}"),
        })?;

    Ok(CaptureLane {
        stop,
        join: Some(join),
        status,
    })
}

fn emit_if_valid(
    seg: &FinalizedSegment,
    last_fp: &Arc<Mutex<Option<String>>>,
    sink: &SegmentSink,
) {
    let mut guard = last_fp.lock();
    match validate_segment(seg, guard.as_deref()) {
        Ok(fp) => {
            *guard = Some(fp);
            sink(seg.clone());
        }
        Err(_) => {
            // Silent reject — no fabricated transcript.
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn build_f32_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    sample_rate: u32,
    segmenter: Arc<Mutex<SpeechSegmenter<WebRtcVoiceDetector>>>,
    last_fp: Arc<Mutex<Option<String>>>,
    sink: SegmentSink,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<Stream, SourceCaptureStatus> {
    device
        .build_input_stream(
            config,
            move |data: &[f32], _| {
                let mono = to_mono_i16(data, channels);
                let pcm16k = resample_mono_i16(&mono, sample_rate, 16_000);
                let segments = segmenter.lock().push_pcm(&pcm16k);
                for seg in segments {
                    emit_if_valid(&seg, &last_fp, &sink);
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| SourceCaptureStatus::Unavailable {
            reason: format!("Failed to open capture stream: {e}"),
        })
}

#[allow(clippy::too_many_arguments)]
fn build_i16_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    sample_rate: u32,
    segmenter: Arc<Mutex<SpeechSegmenter<WebRtcVoiceDetector>>>,
    last_fp: Arc<Mutex<Option<String>>>,
    sink: SegmentSink,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<Stream, SourceCaptureStatus> {
    device
        .build_input_stream(
            config,
            move |data: &[i16], _| {
                let mono = if channels <= 1 {
                    data.to_vec()
                } else {
                    let frames = data.len() / channels;
                    let mut out = Vec::with_capacity(frames);
                    for i in 0..frames {
                        let mut acc = 0i32;
                        for ch in 0..channels {
                            acc += data[i * channels + ch] as i32;
                        }
                        out.push((acc / channels as i32) as i16);
                    }
                    out
                };
                let pcm16k = resample_mono_i16(&mono, sample_rate, 16_000);
                let segments = segmenter.lock().push_pcm(&pcm16k);
                for seg in segments {
                    emit_if_valid(&seg, &last_fp, &sink);
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| SourceCaptureStatus::Unavailable {
            reason: format!("Failed to open capture stream: {e}"),
        })
}

/// Encode segment to WAV bytes for the frontend STT bridge.
pub fn encode_segment_wav(segment: &FinalizedSegment) -> Result<(Vec<u8>, u32), String> {
    let bytes = segment_to_wav_bytes(segment)?;
    let duration_ms =
        (segment.pcm_i16.len() as u64 * 1000 / segment.sample_rate as u64) as u32;
    Ok((bytes, duration_ms))
}
