use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use super::types::AudioSourceKind;
use super::vad::{
    is_audible_frame, VoiceDetector, VAD_FRAME_SAMPLES, VAD_SAMPLE_RATE_HZ,
};

/// Keep this much audio before speech onset (ms).
const PRE_ROLL_MS: u32 = 280;
/// Require this much trailing silence before ending a segment (ms).
const END_SILENCE_MS: u32 = 420;
/// Ignore noise bursts shorter than this (ms).
const MIN_SPEECH_MS: u32 = 360;
/// While speech continues, emit growing-window partials this often (ms).
const PARTIAL_EMIT_MS: u32 = 1_500;
/// Cap a single segment so STT requests stay bounded (ms).
const MAX_SPEECH_MS: u32 = 12_000;
/// Max PCM held while idle / in segment (~20s @ 16 kHz).
const MAX_BUFFER_SAMPLES: usize = VAD_SAMPLE_RATE_HZ as usize * 20;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn ms_to_frames(ms: u32) -> usize {
    (ms as usize) / 20
}

#[derive(Debug, Clone)]
pub struct FinalizedSegment {
    pub source: AudioSourceKind,
    pub pcm_i16: Vec<i16>,
    pub sample_rate: u32,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    /// Stable id for partial + final emits of one spoken utterance.
    pub utterance_id: String,
    /// Growing-window interim emit (PCM is not drained). Final clears the utterance.
    pub is_partial: bool,
}

/// Per-source speech segmenter: independent VAD state + buffers.
pub struct SpeechSegmenter<D: VoiceDetector> {
    source: AudioSourceKind,
    detector: D,
    /// Rolling PCM at 16 kHz mono.
    pcm: VecDeque<i16>,
    /// Pending incomplete frame samples.
    leftover: Vec<i16>,
    in_speech: bool,
    speech_frames: usize,
    silence_frames: usize,
    segment_start_ms: u64,
    utterance_id: String,
    /// `speech_frames` value when the last partial was emitted.
    last_partial_speech_frames: usize,
    pre_roll_frames: usize,
    end_silence_frames: usize,
    min_speech_frames: usize,
    max_speech_frames: usize,
    partial_interval_frames: usize,
}

impl<D: VoiceDetector> SpeechSegmenter<D> {
    pub fn new(source: AudioSourceKind, detector: D) -> Self {
        Self {
            source,
            detector,
            pcm: VecDeque::new(),
            leftover: Vec::new(),
            in_speech: false,
            speech_frames: 0,
            silence_frames: 0,
            segment_start_ms: 0,
            utterance_id: String::new(),
            last_partial_speech_frames: 0,
            pre_roll_frames: ms_to_frames(PRE_ROLL_MS),
            end_silence_frames: ms_to_frames(END_SILENCE_MS),
            min_speech_frames: ms_to_frames(MIN_SPEECH_MS),
            max_speech_frames: ms_to_frames(MAX_SPEECH_MS),
            partial_interval_frames: ms_to_frames(PARTIAL_EMIT_MS),
        }
    }

    /// Push 16 kHz mono PCM. Returns zero or more speech segments (partial and/or final).
    pub fn push_pcm(&mut self, samples: &[i16]) -> Vec<FinalizedSegment> {
        let mut out = Vec::new();
        self.leftover.extend_from_slice(samples);

        while self.leftover.len() >= VAD_FRAME_SAMPLES {
            let frame: Vec<i16> = self.leftover.drain(..VAD_FRAME_SAMPLES).collect();
            out.extend(self.push_frame(&frame));
        }
        out
    }

    fn push_frame(&mut self, frame: &[i16]) -> Vec<FinalizedSegment> {
        let mut out = Vec::new();

        // Bound memory while idle.
        while self.pcm.len() > MAX_BUFFER_SAMPLES {
            self.pcm.pop_front();
        }

        let vad_speech = self.detector.is_speech(frame);
        let audible = is_audible_frame(frame);
        let speech = vad_speech && audible;

        if !self.in_speech {
            // Keep pre-roll window.
            self.pcm.extend(frame.iter().copied());
            let max_pre = self.pre_roll_frames * VAD_FRAME_SAMPLES;
            while self.pcm.len() > max_pre {
                self.pcm.pop_front();
            }

            if speech {
                self.in_speech = true;
                self.speech_frames = 1;
                self.silence_frames = 0;
                self.last_partial_speech_frames = 0;
                self.utterance_id = Uuid::new_v4().to_string();
                self.segment_start_ms = now_ms().saturating_sub(PRE_ROLL_MS as u64);
            }
            return out;
        }

        // In speech: append everything (including short pauses).
        self.pcm.extend(frame.iter().copied());
        if speech {
            self.speech_frames += 1;
            self.silence_frames = 0;
        } else {
            self.silence_frames += 1;
        }

        let hit_end_silence = self.silence_frames >= self.end_silence_frames;
        let hit_max = self.speech_frames >= self.max_speech_frames;

        if hit_end_silence || hit_max {
            if let Some(seg) = self.finalize_current(hit_end_silence) {
                out.push(seg);
            }
            return out;
        }

        if let Some(partial) = self.maybe_emit_partial() {
            out.push(partial);
        }
        out
    }

    fn maybe_emit_partial(&mut self) -> Option<FinalizedSegment> {
        if self.speech_frames < self.min_speech_frames {
            return None;
        }
        let since_last = self
            .speech_frames
            .saturating_sub(self.last_partial_speech_frames);
        if since_last < self.partial_interval_frames {
            return None;
        }

        let pcm: Vec<i16> = self.pcm.iter().copied().collect();
        if pcm.len() < VAD_FRAME_SAMPLES || !segment_has_energy(&pcm) {
            return None;
        }

        self.last_partial_speech_frames = self.speech_frames;
        Some(FinalizedSegment {
            source: self.source,
            pcm_i16: pcm,
            sample_rate: VAD_SAMPLE_RATE_HZ,
            started_at_ms: self.segment_start_ms,
            ended_at_ms: now_ms(),
            utterance_id: self.utterance_id.clone(),
            is_partial: true,
        })
    }

    fn finalize_current(&mut self, trim_trailing_silence: bool) -> Option<FinalizedSegment> {
        let speech_ok = self.speech_frames >= self.min_speech_frames;
        let utterance_id = self.utterance_id.clone();
        let mut pcm: Vec<i16> = self.pcm.drain(..).collect();

        if trim_trailing_silence {
            let trim = self.end_silence_frames.saturating_sub(2) * VAD_FRAME_SAMPLES;
            if pcm.len() > trim {
                pcm.truncate(pcm.len() - trim);
            }
        }

        self.in_speech = false;
        self.speech_frames = 0;
        self.silence_frames = 0;
        self.last_partial_speech_frames = 0;
        self.utterance_id.clear();
        self.leftover.clear();

        if !speech_ok || pcm.len() < VAD_FRAME_SAMPLES {
            return None;
        }

        // Final energy check on the whole segment.
        if !segment_has_energy(&pcm) {
            return None;
        }

        Some(FinalizedSegment {
            source: self.source,
            pcm_i16: pcm,
            sample_rate: VAD_SAMPLE_RATE_HZ,
            started_at_ms: self.segment_start_ms,
            ended_at_ms: now_ms(),
            utterance_id,
            is_partial: false,
        })
    }

    /// Flush any open segment (e.g. on stop). May discard if too short.
    pub fn flush(&mut self) -> Option<FinalizedSegment> {
        if self.in_speech {
            self.finalize_current(false)
        } else {
            self.pcm.clear();
            self.leftover.clear();
            None
        }
    }
}

fn segment_has_energy(pcm: &[i16]) -> bool {
    if pcm.is_empty() {
        return false;
    }
    let mut peaks = 0usize;
    for chunk in pcm.chunks(VAD_FRAME_SAMPLES) {
        if is_audible_frame(chunk) {
            peaks += 1;
        }
    }
    // At least ~3 audible frames (~60ms) inside the segment.
    peaks >= 3
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::vad::VAD_FRAME_SAMPLES;

    struct ScriptedVad {
        /// Per-frame speech decisions.
        decisions: VecDeque<bool>,
    }

    impl VoiceDetector for ScriptedVad {
        fn is_speech(&mut self, _frame: &[i16]) -> bool {
            self.decisions.pop_front().unwrap_or(false)
        }
    }

    fn loud_frame() -> Vec<i16> {
        vec![10_000i16; VAD_FRAME_SAMPLES]
    }

    fn silent_frame() -> Vec<i16> {
        vec![0i16; VAD_FRAME_SAMPLES]
    }

    #[test]
    fn silence_produces_no_segment() {
        let det = ScriptedVad {
            decisions: std::iter::repeat(false).take(50).collect(),
        };
        let mut seg = SpeechSegmenter::new(AudioSourceKind::Microphone, det);
        let mut pcm = Vec::new();
        for _ in 0..50 {
            pcm.extend(silent_frame());
        }
        let out = seg.push_pcm(&pcm);
        assert!(out.is_empty());
    }

    #[test]
    fn brief_noise_burst_rejected() {
        // 1 speech frame (~20ms) then long silence — below MIN_SPEECH_MS.
        let mut decisions = VecDeque::new();
        decisions.push_back(true);
        for _ in 0..40 {
            decisions.push_back(false);
        }
        let mut seg = SpeechSegmenter::new(
            AudioSourceKind::Microphone,
            ScriptedVad { decisions },
        );
        let mut pcm = loud_frame();
        for _ in 0..40 {
            pcm.extend(silent_frame());
        }
        let out = seg.push_pcm(&pcm);
        assert!(out.is_empty(), "noise burst must not finalize");
    }

    #[test]
    fn valid_short_speech_preserved() {
        // ~400ms speech + end silence (above MIN_SPEECH_MS).
        let speech_frames = 20; // 400ms
        let silence_frames = 40; // 800ms
        let mut decisions = VecDeque::new();
        for _ in 0..speech_frames {
            decisions.push_back(true);
        }
        for _ in 0..silence_frames {
            decisions.push_back(false);
        }
        let mut seg = SpeechSegmenter::new(
            AudioSourceKind::Meeting,
            ScriptedVad { decisions },
        );
        let mut pcm = Vec::new();
        for _ in 0..speech_frames {
            pcm.extend(loud_frame());
        }
        for _ in 0..silence_frames {
            pcm.extend(silent_frame());
        }
        let out = seg.push_pcm(&pcm);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].source, AudioSourceKind::Meeting);
        assert!(!out[0].is_partial);
        assert!(!out[0].utterance_id.is_empty());
        assert!(out[0].pcm_i16.len() >= VAD_FRAME_SAMPLES * 10);
    }

    #[test]
    fn long_speech_emits_partial_then_final() {
        // ~3.2s speech → at least one partial (~1.5s), then silence → final.
        let speech_frames = 160; // 3200ms
        let silence_frames = 30; // 600ms
        let mut decisions = VecDeque::new();
        for _ in 0..speech_frames {
            decisions.push_back(true);
        }
        for _ in 0..silence_frames {
            decisions.push_back(false);
        }
        let mut seg = SpeechSegmenter::new(
            AudioSourceKind::Microphone,
            ScriptedVad { decisions },
        );
        let mut pcm = Vec::new();
        for _ in 0..speech_frames {
            pcm.extend(loud_frame());
        }
        for _ in 0..silence_frames {
            pcm.extend(silent_frame());
        }
        let out = seg.push_pcm(&pcm);
        assert!(out.len() >= 2, "expected partial(s) + final, got {}", out.len());
        assert!(out.iter().any(|s| s.is_partial));
        let final_seg = out.last().unwrap();
        assert!(!final_seg.is_partial);
        let utterance = &final_seg.utterance_id;
        assert!(out.iter().all(|s| s.utterance_id == *utterance));
    }

    #[test]
    fn independent_buffers_do_not_share_state() {
        let mut mic = SpeechSegmenter::new(
            AudioSourceKind::Microphone,
            ScriptedVad {
                decisions: VecDeque::from(vec![true, true, true]),
            },
        );
        let mut meeting = SpeechSegmenter::new(
            AudioSourceKind::Meeting,
            ScriptedVad {
                decisions: VecDeque::from(vec![false, false, false]),
            },
        );
        let frame = loud_frame();
        let _ = mic.push_pcm(&frame);
        let meeting_out = meeting.push_pcm(&silent_frame());
        assert!(meeting_out.is_empty());
        assert!(mic.in_speech);
        assert!(!meeting.in_speech);
    }
}
