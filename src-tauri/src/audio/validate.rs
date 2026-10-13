use super::segmenter::FinalizedSegment;
use super::vad::{frame_rms, VAD_FRAME_SAMPLES, VAD_SAMPLE_RATE_HZ};

/// Normalized RMS floor shared with the segmenter energy gate.
pub const AUDIBLE_RMS: f32 = 0.014;
/// Stronger peak required before we trust short courtesy phrases from Whisper.
pub const STRONG_PEAK_RMS: f32 = 0.04;
/// Minimum audible frames (~100ms) to send anything to STT.
const MIN_AUDIBLE_FRAMES: usize = 5;
/// Audible frames for "strong" speech evidence (~300ms).
const STRONG_AUDIBLE_FRAMES: usize = 15;
/// Reject segments shorter than this (ms) — Whisper fills tiny clips.
const MIN_DURATION_MS: u64 = 320;
/// Fraction of samples at |amp| >= clip threshold → reject as corrupted.
const MAX_CLIP_RATIO: f32 = 0.02;
const CLIP_ABS: i16 = 32_000;
/// Zero-crossing rate outside speech-like band → noise / tone / click train.
const MIN_SPEECH_ZCR: f32 = 0.012;
const MAX_SPEECH_ZCR: f32 = 0.42;
/// Peak / RMS crest; impulsive keyboard clicks sit far above speech.
const MAX_CREST: f32 = 18.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentRejectReason {
    Empty,
    TooShort,
    WrongSampleRate,
    NearSilent,
    NoiseOnly,
    Clipped,
    Duplicate,
}

impl SegmentRejectReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::TooShort => "too_short",
            Self::WrongSampleRate => "wrong_sample_rate",
            Self::NearSilent => "near_silent",
            Self::NoiseOnly => "noise_only",
            Self::Clipped => "clipped",
            Self::Duplicate => "duplicate",
        }
    }
}

/// Privacy-safe acoustic summary (no PCM / no transcript).
#[derive(Debug, Clone, PartialEq)]
pub struct SegmentEvidence {
    pub duration_ms: u32,
    pub peak_rms: f32,
    pub audible_frames: u32,
    pub clip_ratio: f32,
    pub zero_crossing_rate: f32,
    pub crest_factor: f32,
    /// `strong` | `marginal` — used by the client for courtesy-phrase gating.
    pub tier: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedSegment {
    pub fingerprint: String,
    pub evidence: SegmentEvidence,
}

/// Privacy-safe metrics for tests (computed even when validation fails).
#[cfg(test)]
#[derive(Debug, Clone, Copy)]
struct SegmentDiagMetrics {
    duration_ms: u32,
    peak_rms: f32,
    audible_frames: u32,
    clip_ratio: f32,
    zero_crossing_rate: f32,
    crest_factor: f32,
}

/// Compute acoustic scalars without applying accept/reject gates.
#[cfg(test)]
fn segment_diag_metrics(segment: &FinalizedSegment) -> SegmentDiagMetrics {
    let duration_ms = if segment.sample_rate == 0 {
        0
    } else {
        (segment.pcm_i16.len() as u64 * 1000 / segment.sample_rate as u64) as u32
    };
    let mut audible = 0u32;
    let mut peak_rms = 0.0f32;
    let mut clipped = 0usize;
    for chunk in segment.pcm_i16.chunks(VAD_FRAME_SAMPLES) {
        let rms = frame_rms(chunk);
        peak_rms = peak_rms.max(rms);
        if rms >= AUDIBLE_RMS {
            audible += 1;
        }
    }
    for &s in &segment.pcm_i16 {
        if s.saturating_abs() >= CLIP_ABS {
            clipped += 1;
        }
    }
    let clip_ratio = if segment.pcm_i16.is_empty() {
        0.0
    } else {
        clipped as f32 / segment.pcm_i16.len() as f32
    };
    let zcr = zero_crossing_rate(&segment.pcm_i16);
    let crest = crest_factor(&segment.pcm_i16, peak_rms);
    SegmentDiagMetrics {
        duration_ms,
        peak_rms,
        audible_frames: audible,
        clip_ratio,
        zero_crossing_rate: zcr,
        crest_factor: crest,
    }
}

/// Validate a speech segment before it is sent to the transcription provider.
/// RMS alone is not treated as proof of speech — ZCR + crest reject clicks/noise.
pub fn validate_segment(
    segment: &FinalizedSegment,
    last_fingerprint: Option<&str>,
) -> Result<ValidatedSegment, SegmentRejectReason> {
    if segment.pcm_i16.is_empty() {
        return Err(SegmentRejectReason::Empty);
    }
    if segment.sample_rate != VAD_SAMPLE_RATE_HZ {
        return Err(SegmentRejectReason::WrongSampleRate);
    }
    let duration_ms =
        (segment.pcm_i16.len() as u64 * 1000) / segment.sample_rate as u64;
    if duration_ms < MIN_DURATION_MS {
        return Err(SegmentRejectReason::TooShort);
    }

    let mut audible = 0usize;
    let mut peak_rms = 0.0f32;
    let mut clipped = 0usize;
    for chunk in segment.pcm_i16.chunks(VAD_FRAME_SAMPLES) {
        let rms = frame_rms(chunk);
        peak_rms = peak_rms.max(rms);
        if rms >= AUDIBLE_RMS {
            audible += 1;
        }
    }
    for &s in &segment.pcm_i16 {
        if s.saturating_abs() >= CLIP_ABS {
            clipped += 1;
        }
    }
    let clip_ratio = clipped as f32 / segment.pcm_i16.len() as f32;
    if clip_ratio > MAX_CLIP_RATIO {
        return Err(SegmentRejectReason::Clipped);
    }

    // ~100ms of real energy (5 × 20ms frames), not a single click.
    if audible < MIN_AUDIBLE_FRAMES || peak_rms < AUDIBLE_RMS {
        return Err(SegmentRejectReason::NearSilent);
    }

    let zcr = zero_crossing_rate(&segment.pcm_i16);
    let crest = crest_factor(&segment.pcm_i16, peak_rms);
    // Impulsive / hissy / pure-tone energy without speech-like modulation.
    if crest > MAX_CREST || zcr < MIN_SPEECH_ZCR || zcr > MAX_SPEECH_ZCR {
        return Err(SegmentRejectReason::NoiseOnly);
    }

    let fingerprint = fingerprint_segment(segment);
    if let Some(prev) = last_fingerprint {
        if prev == fingerprint {
            return Err(SegmentRejectReason::Duplicate);
        }
    }

    let tier = if audible >= STRONG_AUDIBLE_FRAMES
        && peak_rms >= STRONG_PEAK_RMS
        && (MIN_SPEECH_ZCR + 0.008..MAX_SPEECH_ZCR - 0.05).contains(&zcr)
    {
        "strong"
    } else {
        "marginal"
    };

    Ok(ValidatedSegment {
        fingerprint,
        evidence: SegmentEvidence {
            duration_ms: duration_ms as u32,
            peak_rms,
            audible_frames: audible as u32,
            clip_ratio,
            zero_crossing_rate: zcr,
            crest_factor: crest,
            tier,
        },
    })
}

fn zero_crossing_rate(pcm: &[i16]) -> f32 {
    if pcm.len() < 2 {
        return 0.0;
    }
    let mut crossings = 0usize;
    for i in 1..pcm.len() {
        let a = pcm[i - 1];
        let b = pcm[i];
        if a == 0 && b == 0 {
            continue;
        }
        if (a >= 0) != (b >= 0) {
            crossings += 1;
        }
    }
    crossings as f32 / (pcm.len() - 1) as f32
}

fn crest_factor(pcm: &[i16], peak_rms: f32) -> f32 {
    if peak_rms < 1e-6 {
        return 0.0;
    }
    let peak = pcm
        .iter()
        .map(|s| s.saturating_abs() as f32 / i16::MAX as f32)
        .fold(0.0f32, f32::max);
    peak / peak_rms
}

fn fingerprint_segment(segment: &FinalizedSegment) -> String {
    // Coarse energy + length fingerprint to suppress identical re-emits.
    let len = segment.pcm_i16.len();
    let step = (len / 16).max(1);
    let mut acc: i64 = len as i64;
    for sample in segment.pcm_i16.iter().step_by(step).take(32) {
        acc = acc.wrapping_mul(31).wrapping_add(*sample as i64);
    }
    format!("{}:{acc}", segment.source.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::types::AudioSourceKind;

    fn segment_with(pcm: Vec<i16>) -> FinalizedSegment {
        let ms = (pcm.len() as u64 * 1000) / VAD_SAMPLE_RATE_HZ as u64;
        FinalizedSegment {
            source: AudioSourceKind::Microphone,
            pcm_i16: pcm,
            sample_rate: VAD_SAMPLE_RATE_HZ,
            started_at_ms: 0,
            ended_at_ms: ms,
            utterance_id: "test-utt".into(),
            is_partial: false,
        }
    }

    /// Rough speech-like tone burst (not silence, not white noise).
    fn speech_like_pcm(ms: u32, amplitude: i16) -> Vec<i16> {
        let n = (VAD_SAMPLE_RATE_HZ * ms / 1000) as usize;
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            // ~200 Hz square-ish → mid ZCR, stable energy.
            let s = if (i / 40) % 2 == 0 { amplitude } else { -amplitude };
            out.push(s);
        }
        out
    }

    #[test]
    fn rejects_digital_silence() {
        let n = VAD_SAMPLE_RATE_HZ as usize;
        let seg = segment_with(vec![0; n]);
        assert_eq!(
            validate_segment(&seg, None).unwrap_err(),
            SegmentRejectReason::NearSilent
        );
    }

    #[test]
    fn rejects_near_silence() {
        let n = VAD_SAMPLE_RATE_HZ as usize;
        let seg = segment_with(vec![40i16; n]);
        assert_eq!(
            validate_segment(&seg, None).unwrap_err(),
            SegmentRejectReason::NearSilent
        );
    }

    #[test]
    fn rejects_too_short() {
        let seg = segment_with(vec![9_000; 100]);
        assert_eq!(
            validate_segment(&seg, None).unwrap_err(),
            SegmentRejectReason::TooShort
        );
    }

    #[test]
    fn rejects_impulse_click_train() {
        // Mostly silence with rare full-scale spikes (keyboard-like).
        let n = (VAD_SAMPLE_RATE_HZ as usize) * 1; // 1s
        let mut pcm = vec![0i16; n];
        for i in (0..n).step_by(800) {
            pcm[i] = 30_000;
        }
        let seg = segment_with(pcm);
        let err = validate_segment(&seg, None).unwrap_err();
        assert!(
            matches!(
                err,
                SegmentRejectReason::NearSilent | SegmentRejectReason::NoiseOnly
            ),
            "unexpected {err:?}"
        );
    }

    #[test]
    fn rejects_white_noise_like_zcr() {
        // Alternating ±amp every sample → ZCR ≈ 1.0 (not speech).
        let n = (VAD_SAMPLE_RATE_HZ as usize) / 2; // 500ms
        let mut pcm = Vec::with_capacity(n);
        for i in 0..n {
            pcm.push(if i % 2 == 0 { 8_000 } else { -8_000 });
        }
        let seg = segment_with(pcm);
        assert_eq!(
            validate_segment(&seg, None).unwrap_err(),
            SegmentRejectReason::NoiseOnly
        );
    }

    #[test]
    fn accepts_speech_like_energy() {
        let seg = segment_with(speech_like_pcm(400, 9_000));
        let ok = validate_segment(&seg, None).unwrap();
        assert!(ok.evidence.audible_frames >= 5);
        assert!(ok.evidence.tier == "strong" || ok.evidence.tier == "marginal");
    }

    #[test]
    fn low_volume_speech_like_may_pass_as_marginal() {
        // Peak RMS ≈ 800/32767 ≈ 0.024 — above audible floor, below strong tier.
        let seg = segment_with(speech_like_pcm(500, 800));
        let ok = validate_segment(&seg, None).unwrap();
        assert_eq!(ok.evidence.tier, "marginal");
    }

    #[test]
    fn rejects_duplicate_fingerprint() {
        let seg = segment_with(speech_like_pcm(400, 9_000));
        let fp = validate_segment(&seg, None).unwrap().fingerprint;
        assert_eq!(
            validate_segment(&seg, Some(&fp)).unwrap_err(),
            SegmentRejectReason::Duplicate
        );
    }

    #[test]
    fn rejects_heavy_clipping() {
        let n = (VAD_SAMPLE_RATE_HZ as usize) / 2;
        let seg = segment_with(vec![32_500i16; n]);
        assert_eq!(
            validate_segment(&seg, None).unwrap_err(),
            SegmentRejectReason::Clipped
        );
    }

    /// Documents a likely live-mic failure mode: voiced energy with low ZCR
    /// (≈ 2·f0/fs for f0≈85 Hz) is rejected as `noise_only` by MIN_SPEECH_ZCR.
    /// Thresholds are intentionally unchanged here — diagnostics only.
    #[test]
    fn low_pitch_voiced_like_energy_hits_noise_only_zcr_gate() {
        // ~85 Hz square @ 16 kHz → ZCR ≈ 0.0106 < MIN_SPEECH_ZCR (0.012).
        let n = (VAD_SAMPLE_RATE_HZ as usize) / 2; // 500ms
        let half_period = 94usize; // period ≈ 188 samples → ~85 Hz
        let mut pcm = Vec::with_capacity(n);
        for i in 0..n {
            let s = if (i / half_period) % 2 == 0 {
                10_000i16
            } else {
                -10_000
            };
            pcm.push(s);
        }
        let seg = segment_with(pcm);
        let m = segment_diag_metrics(&seg);
        assert!(
            m.zero_crossing_rate < MIN_SPEECH_ZCR,
            "diag zcr={:.4} should be below gate",
            m.zero_crossing_rate
        );
        assert!(m.peak_rms >= AUDIBLE_RMS);
        assert_eq!(
            validate_segment(&seg, None).unwrap_err(),
            SegmentRejectReason::NoiseOnly
        );
    }
}
