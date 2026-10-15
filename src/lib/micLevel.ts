/** Visual band for the Meet-style input meter. */
export type MicLevelBand = "silent" | "quiet" | "good" | "hot";

/** Soft speech → yellow; clear → green; clipping/scream → red. */
export function classifyMicLevel(level01: number): MicLevelBand {
  if (level01 < 0.04) return "silent";
  if (level01 < 0.28) return "quiet";
  if (level01 < 0.72) return "good";
  return "hot";
}

export function rmsFromTimeDomain(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** Map raw float RMS (~0.01–0.25 for speech) into a 0–1 meter fill. */
export function normalizeMicRms(rms: number, gain = 6.5): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, Math.max(0, rms * gain));
}
