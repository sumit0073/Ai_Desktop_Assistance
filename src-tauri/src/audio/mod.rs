//! Native dual-source meeting audio pipeline.
//!
//! Microphone and meeting/system audio are captured independently, run through
//! WebRTC VAD + energy gating, and only finalized speech segments are emitted
//! to the frontend for transcription (Groq Whisper). Silent / muted buffers
//! never produce transcript events.

pub mod capture;
pub mod resample;
pub mod segmenter;
pub mod session;
pub mod types;
pub mod vad;
pub mod validate;
pub mod wav;

pub use session::{
    ack_speech_segment, meeting_capture_status, start_meeting_capture, stop_meeting_capture,
    MeetingCaptureState,
};
