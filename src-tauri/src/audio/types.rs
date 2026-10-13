use serde::Serialize;

/// Independent capture lanes — never mixed before transcription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioSourceKind {
    Microphone,
    Meeting,
}

impl AudioSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::Meeting => "meeting",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceCaptureStatus {
    Active,
    Unavailable { reason: String },
    PermissionDenied { reason: String },
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingCaptureStatus {
    pub recording: bool,
    pub microphone: SourceCaptureStatus,
    pub meeting: SourceCaptureStatus,
}

/// Privacy-safe acoustic summary attached to segments sent for STT.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechEvidencePayload {
    pub duration_ms: u32,
    pub peak_rms: f32,
    pub audible_frames: u32,
    pub clip_ratio: f32,
    pub zero_crossing_rate: f32,
    pub crest_factor: f32,
    /// `strong` | `marginal`
    pub tier: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSegmentEvent {
    pub id: String,
    /// Groups partial + final emits for one spoken utterance.
    pub utterance_id: String,
    pub source: AudioSourceKind,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub sample_rate: u32,
    pub duration_ms: u32,
    /// 16-bit mono PCM WAV, base64-encoded.
    pub wav_base64: String,
    /// `"partial"` while speech continues; `"finalized"` after end-of-speech.
    pub status: &'static str,
    pub evidence: SpeechEvidencePayload,
}

/// Pre-STT rejection — no PCM, no transcript text.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentRejectedEvent {
    pub source: AudioSourceKind,
    pub reason: &'static str,
    pub duration_ms: u32,
    pub is_partial: bool,
    pub utterance_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPipelineError {
    pub source: Option<AudioSourceKind>,
    pub message: String,
}
