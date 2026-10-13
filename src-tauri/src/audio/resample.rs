/// Convert interleaved f32 samples to mono i16 at the source rate.
pub fn to_mono_i16(input: &[f32], channels: usize) -> Vec<i16> {
    if channels <= 1 {
        return input
            .iter()
            .map(|s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .collect();
    }
    let frames = input.len() / channels;
    let mut out = Vec::with_capacity(frames);
    for frame in 0..frames {
        let mut acc = 0.0f32;
        for ch in 0..channels {
            acc += input[frame * channels + ch];
        }
        let sample = (acc / channels as f32).clamp(-1.0, 1.0);
        out.push((sample * i16::MAX as f32) as i16);
    }
    out
}

/// Linear resample mono i16 from `from_hz` to `to_hz`.
pub fn resample_mono_i16(input: &[i16], from_hz: u32, to_hz: u32) -> Vec<i16> {
    if input.is_empty() || from_hz == 0 || to_hz == 0 {
        return Vec::new();
    }
    if from_hz == to_hz {
        return input.to_vec();
    }
    let out_len = ((input.len() as u64 * to_hz as u64) / from_hz as u64) as usize;
    if out_len == 0 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = i as f64 * (from_hz as f64 / to_hz as f64);
        let idx = src_pos.floor() as usize;
        let frac = src_pos - idx as f64;
        let a = input[idx.min(input.len() - 1)] as f64;
        let b = input[(idx + 1).min(input.len() - 1)] as f64;
        out.push((a + (b - a) * frac).round() as i16);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_passthrough() {
        let samples = [0.0f32, 0.5, -0.5];
        let mono = to_mono_i16(&samples, 1);
        assert_eq!(mono.len(), 3);
        assert!(mono[1] > 0);
        assert!(mono[2] < 0);
    }

    #[test]
    fn stereo_averages() {
        let samples = [1.0f32, -1.0, 0.5, 0.5];
        let mono = to_mono_i16(&samples, 2);
        assert_eq!(mono.len(), 2);
        assert_eq!(mono[0], 0);
        assert!(mono[1] > 0);
    }

    #[test]
    fn resample_doubles_length_when_upsampling_2x() {
        let input = vec![0i16, 1000, 0, -1000];
        let out = resample_mono_i16(&input, 8_000, 16_000);
        assert_eq!(out.len(), 8);
    }
}
