use webrtc_vad::{SampleRate, Vad, VadMode};

/// Target rate for WebRTC VAD (required by the library).
pub const VAD_SAMPLE_RATE_HZ: u32 = 16_000;
/// Frame length in milliseconds (10 / 20 / 30 supported).
pub const VAD_FRAME_MS: usize = 20;
pub const VAD_FRAME_SAMPLES: usize = VAD_SAMPLE_RATE_HZ as usize * VAD_FRAME_MS / 1000;

pub trait VoiceDetector: Send {
    fn is_speech(&mut self, frame: &[i16]) -> bool;
}

/// WebRTC VAD — lightweight, offline, BSD-style WebRTC license.
/// Model is embedded C code (no separate weight download).
pub struct WebRtcVoiceDetector {
    vad: Vad,
}

// webrtc-vad holds a raw FFI pointer and is not marked Send. We only ever
// touch each detector from a single capture thread behind a Mutex.
unsafe impl Send for WebRtcVoiceDetector {}

impl WebRtcVoiceDetector {
    pub fn new() -> Result<Self, String> {
        let mut vad = Vad::new();
        vad.set_sample_rate(SampleRate::Rate16kHz);
        // Quality keeps more of soft / fast speech than Aggressive (which can
        // chop uncommon words and hurt Whisper accuracy).
        vad.set_mode(VadMode::Quality);
        Ok(Self { vad })
    }
}

impl VoiceDetector for WebRtcVoiceDetector {
    fn is_speech(&mut self, frame: &[i16]) -> bool {
        if frame.len() != VAD_FRAME_SAMPLES {
            return false;
        }
        self.vad.is_voice_segment(frame).unwrap_or(false)
    }
}

/// RMS energy gate — rejects near-silent frames even if VAD misfires.
pub fn frame_rms(frame: &[i16]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = frame.iter().map(|s| {
        let x = *s as f64;
        x * x
    }).sum();
    ((sum_sq / frame.len() as f64).sqrt() / i16::MAX as f64) as f32
}

/// Default silence floor for ordinary meeting speech (normalized 0–1).
pub const SILENCE_RMS_THRESHOLD: f32 = 0.012;

pub fn is_audible_frame(frame: &[i16]) -> bool {
    frame_rms(frame) >= SILENCE_RMS_THRESHOLD
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_rms_is_near_zero() {
        let frame = vec![0i16; VAD_FRAME_SAMPLES];
        assert!(frame_rms(&frame) < 0.001);
        assert!(!is_audible_frame(&frame));
    }

    #[test]
    fn loud_frame_is_audible() {
        let frame = vec![8_000i16; VAD_FRAME_SAMPLES];
        assert!(is_audible_frame(&frame));
    }
}
