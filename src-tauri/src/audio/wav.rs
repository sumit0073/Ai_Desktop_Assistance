use std::io::Cursor;

use hound::{SampleFormat, WavSpec, WavWriter};

use super::segmenter::FinalizedSegment;

/// Encode a finalized PCM segment as 16-bit mono WAV bytes.
pub fn segment_to_wav_bytes(segment: &FinalizedSegment) -> Result<Vec<u8>, String> {
    if segment.pcm_i16.is_empty() {
        return Err("empty pcm".into());
    }
    let spec = WavSpec {
        channels: 1,
        sample_rate: segment.sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer =
            WavWriter::new(&mut cursor, spec).map_err(|e| format!("wav writer: {e}"))?;
        for sample in &segment.pcm_i16 {
            writer
                .write_sample(*sample)
                .map_err(|e| format!("wav sample: {e}"))?;
        }
        writer.finalize().map_err(|e| format!("wav finalize: {e}"))?;
    }
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::types::AudioSourceKind;

    #[test]
    fn writes_riff_header() {
        let seg = FinalizedSegment {
            source: AudioSourceKind::Microphone,
            pcm_i16: vec![0, 100, -100, 0],
            sample_rate: 16_000,
            started_at_ms: 0,
            ended_at_ms: 10,
            utterance_id: "test-utt".into(),
            is_partial: false,
        };
        let bytes = segment_to_wav_bytes(&seg).unwrap();
        assert!(bytes.len() > 44);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
    }
}
