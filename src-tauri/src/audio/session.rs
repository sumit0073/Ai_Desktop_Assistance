use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use super::capture::{
    encode_segment_wav, start_meeting, start_microphone, CaptureLane, RejectSink, SegmentSink,
};
use super::segmenter::FinalizedSegment;
use super::types::{
    AudioPipelineError, AudioSourceKind, MeetingCaptureStatus, SegmentRejectedEvent,
    SourceCaptureStatus, SpeechEvidencePayload, SpeechSegmentEvent,
};

const MAX_PENDING_SEGMENTS: usize = 4;

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct MeetingCaptureState {
    inner: Mutex<Option<ActiveSession>>,
    pending: Arc<AtomicUsize>,
}

struct ActiveSession {
    microphone: Option<CaptureLane>,
    meeting: Option<CaptureLane>,
}

impl Default for MeetingCaptureState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            pending: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl MeetingCaptureState {
    pub fn status(&self) -> MeetingCaptureStatus {
        let guard = self.inner.lock();
        match guard.as_ref() {
            None => MeetingCaptureStatus {
                recording: false,
                microphone: SourceCaptureStatus::Stopped,
                meeting: SourceCaptureStatus::Stopped,
            },
            Some(session) => MeetingCaptureStatus {
                recording: true,
                microphone: session
                    .microphone
                    .as_ref()
                    .map(|l| l.status())
                    .unwrap_or(SourceCaptureStatus::Stopped),
                meeting: session.meeting.as_ref().map(|l| l.status()).unwrap_or(
                    SourceCaptureStatus::Unavailable {
                        reason: "Meeting audio source was not started.".into(),
                    },
                ),
            },
        }
    }
}

fn emit_error(app: &AppHandle, source: Option<AudioSourceKind>, message: impl Into<String>) {
    let _ = app.emit(
        "seecog://audio-error",
        AudioPipelineError {
            source,
            message: message.into(),
        },
    );
}

fn emit_status(app: &AppHandle, status: &MeetingCaptureStatus) {
    let _ = app.emit("seecog://audio-status", status);
}

fn make_segment_sink(app: AppHandle, pending: Arc<AtomicUsize>) -> SegmentSink {
    Arc::new(move |(segment, evidence): (FinalizedSegment, SpeechEvidencePayload)| {
        let current = pending.load(Ordering::SeqCst);
        // Drop interim partials when the UI/STT queue is busy so finals stay responsive.
        // Frontend should ack promptly after accept (not after STT) so this rarely trips.
        if segment.is_partial && current > 0 {
            eprintln!(
                "[audio-latency] drop_partial source={} pending={} utterance={}",
                segment.source.as_str(),
                current,
                segment.utterance_id
            );
            return;
        }
        if current >= MAX_PENDING_SEGMENTS {
            eprintln!(
                "[audio-latency] drop_over_cap source={} pending={} partial={}",
                segment.source.as_str(),
                current,
                segment.is_partial
            );
            return;
        }
        pending.fetch_add(1, Ordering::SeqCst);

        let (bytes, duration_ms) = match encode_segment_wav(&segment) {
            Ok(v) => v,
            Err(err) => {
                pending.fetch_sub(1, Ordering::SeqCst);
                emit_error(&app, Some(segment.source), err);
                return;
            }
        };

        let emitted_at_ms = now_ms();
        let speech_to_emit_ms = emitted_at_ms.saturating_sub(segment.started_at_ms);
        // Privacy-safe timing only — no PCM / no transcript.
        eprintln!(
            "[audio-latency] emit id_suffix={} source={} partial={} audio_ms={} speech_to_emit_ms={} pending={}",
            &segment.utterance_id.get(..8).unwrap_or(&segment.utterance_id),
            segment.source.as_str(),
            segment.is_partial,
            duration_ms,
            speech_to_emit_ms,
            pending.load(Ordering::SeqCst)
        );

        let event = SpeechSegmentEvent {
            id: Uuid::new_v4().to_string(),
            utterance_id: segment.utterance_id.clone(),
            source: segment.source,
            started_at_ms: segment.started_at_ms,
            ended_at_ms: segment.ended_at_ms,
            emitted_at_ms,
            sample_rate: segment.sample_rate,
            duration_ms,
            wav_base64: STANDARD.encode(bytes),
            status: if segment.is_partial {
                "partial"
            } else {
                "finalized"
            },
            evidence,
        };

        if app.emit("seecog://speech-segment", &event).is_err() {
            pending.fetch_sub(1, Ordering::SeqCst);
        }
    })
}

fn make_reject_sink(app: AppHandle) -> RejectSink {
    Arc::new(move |segment: FinalizedSegment, reason: &'static str| {
        let duration_ms =
            (segment.pcm_i16.len() as u64 * 1000 / segment.sample_rate.max(1) as u64) as u32;
        let _ = app.emit(
            "seecog://segment-rejected",
            SegmentRejectedEvent {
                source: segment.source,
                reason,
                duration_ms,
                is_partial: segment.is_partial,
                utterance_id: segment.utterance_id.clone(),
            },
        );
    })
}

#[tauri::command]
pub fn meeting_capture_status(state: State<'_, MeetingCaptureState>) -> MeetingCaptureStatus {
    state.status()
}

#[tauri::command]
pub fn stop_meeting_capture(
    app: AppHandle,
    state: State<'_, MeetingCaptureState>,
) -> Result<(), String> {
    let session = state.inner.lock().take();
    if let Some(session) = session {
        if let Some(lane) = session.microphone {
            lane.stop();
        }
        if let Some(lane) = session.meeting {
            lane.stop();
        }
    }
    state.pending.store(0, Ordering::SeqCst);
    emit_status(&app, &state.status());
    Ok(())
}

#[tauri::command]
pub fn start_meeting_capture(
    app: AppHandle,
    state: State<'_, MeetingCaptureState>,
) -> Result<MeetingCaptureStatus, String> {
    if state.inner.lock().is_some() {
        return Ok(state.status());
    }

    state.pending.store(0, Ordering::SeqCst);
    let pending = Arc::clone(&state.pending);

    let mic_sink = make_segment_sink(app.clone(), Arc::clone(&pending));
    let meeting_sink = make_segment_sink(app.clone(), Arc::clone(&pending));
    let mic_reject = make_reject_sink(app.clone());
    let meeting_reject = make_reject_sink(app.clone());

    let mut meeting_status_override: Option<SourceCaptureStatus> = None;

    let microphone = match start_microphone(mic_sink, mic_reject) {
        Ok(lane) => Some(lane),
        Err(status) => {
            let msg = match &status {
                SourceCaptureStatus::PermissionDenied { reason }
                | SourceCaptureStatus::Unavailable { reason } => reason.clone(),
                SourceCaptureStatus::Active | SourceCaptureStatus::Stopped => {
                    "Microphone unavailable.".into()
                }
            };
            emit_error(&app, Some(AudioSourceKind::Microphone), msg);
            None
        }
    };

    let meeting = match start_meeting(meeting_sink, meeting_reject) {
        Ok(lane) => Some(lane),
        Err(status) => {
            let msg = match &status {
                SourceCaptureStatus::PermissionDenied { reason }
                | SourceCaptureStatus::Unavailable { reason } => reason.clone(),
                SourceCaptureStatus::Active | SourceCaptureStatus::Stopped => {
                    "Meeting audio unavailable.".into()
                }
            };
            emit_error(&app, Some(AudioSourceKind::Meeting), msg.clone());
            meeting_status_override = Some(status);
            None
        }
    };

    if microphone.is_none() && meeting.is_none() {
        return Err(
            "Could not start microphone or meeting audio capture. Check permissions and devices."
                .into(),
        );
    }

    *state.inner.lock() = Some(ActiveSession {
        microphone,
        meeting,
    });

    let mut status = state.status();
    if let Some(meeting_status) = meeting_status_override {
        status.meeting = meeting_status;
    }
    emit_status(&app, &status);
    Ok(status)
}

/// Call after a speech segment has been transcribed or discarded (backpressure).
#[tauri::command]
pub fn ack_speech_segment(state: State<'_, MeetingCaptureState>) {
    loop {
        let cur = state.pending.load(Ordering::SeqCst);
        let next = cur.saturating_sub(1);
        if state
            .pending
            .compare_exchange(cur, next, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            break;
        }
    }
}
