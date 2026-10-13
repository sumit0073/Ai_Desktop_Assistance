use super::segmenter::FinalizedSegment;
use super::vad::{frame_rms, VAD_FRAME_SAMPLES, VAD_SAMPLE_RATE_HZ};

#[derive(Debug, PartialEq, Eq)]
pub enum SegmentRejectReason {
    Empty,
    TooShort,
    WrongSampleRate,
    NearSilent,
    Duplicate,
}

/// Validate a speech segment before it is sent to the transcription provider.
pub fn validate_segment(
    segment: &FinalizedSegment,
    last_fingerprint: Option<&str>,
) -> Result<String, SegmentRejectReason> {
    if segment.pcm_i16.is_empty() {
        return Err(SegmentRejectReason::Empty);
    }
    if segment.sample_rate != VAD_SAMPLE_RATE_HZ {
        return Err(SegmentRejectReason::WrongSampleRate);
    }
    let duration_ms =
        (segment.pcm_i16.len() as u64 * 1000) / segment.sample_rate as u64;
    if duration_ms < 200 {
        return Err(SegmentRejectReason::TooShort);
    }

    let mut audible = 0usize;
    let mut peak_rms = 0.0f32;
    for chunk in segment.pcm_i16.chunks(VAD_FRAME_SAMPLES) {
        let rms = frame_rms(chunk);
        peak_rms = peak_rms.max(rms);
        if rms >= 0.012 {
            audible += 1;
        }
    }
    if audible < 3 || peak_rms < 0.012 {
        return Err(SegmentRejectReason::NearSilent);
    }

    let fingerprint = fingerprint_segment(segment);
    if let Some(prev) = last_fingerprint {
        if prev == fingerprint {
            return Err(SegmentRejectReason::Duplicate);
        }
    }
    Ok(fingerprint)
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

    fn loud_segment(ms: u32) -> FinalizedSegment {
        let n = (VAD_SAMPLE_RATE_HZ * ms / 1000) as usize;
        FinalizedSegment {
            source: AudioSourceKind::Microphone,
            pcm_i16: vec![9_000i16; n],
            sample_rate: VAD_SAMPLE_RATE_HZ,
            started_at_ms: 0,
            ended_at_ms: ms as u64,
            utterance_id: "test-utt".into(),
            is_partial: false,
        }
    }

    #[test]
    fn rejects_silence() {
        let n = VAD_SAMPLE_RATE_HZ as usize; // 1s
        let seg = FinalizedSegment {
            source: AudioSourceKind::Microphone,
            pcm_i16: vec![0; n],
            sample_rate: VAD_SAMPLE_RATE_HZ,
            started_at_ms: 0,
            ended_at_ms: 1000,
            utterance_id: "test-utt".into(),
            is_partial: false,
        };
        assert_eq!(
            validate_segment(&seg, None).unwrap_err(),
            SegmentRejectReason::NearSilent
        );
    }

    #[test]
    fn rejects_too_short() {
        let seg = FinalizedSegment {
            source: AudioSourceKind::Meeting,
            pcm_i16: vec![9_000; 100],
            sample_rate: VAD_SAMPLE_RATE_HZ,
            started_at_ms: 0,
            ended_at_ms: 10,
            utterance_id: "test-utt".into(),
            is_partial: false,
        };
        assert_eq!(
            validate_segment(&seg, None).unwrap_err(),
            SegmentRejectReason::TooShort
        );
    }

    #[test]
    fn accepts_valid_speech_like_energy() {
        let seg = loud_segment(400);
        assert!(validate_segment(&seg, None).is_ok());
    }

    #[test]
    fn rejects_duplicate_fingerprint() {
        let seg = loud_segment(400);
        let fp = validate_segment(&seg, None).unwrap();
        assert_eq!(
            validate_segment(&seg, Some(&fp)).unwrap_err(),
            SegmentRejectReason::Duplicate
        );
    }
}
