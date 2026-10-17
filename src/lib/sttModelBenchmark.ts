/**
 * Offline guidance + synthetic comparison helpers for STT model choice.
 *
 * Real WER / latency benchmarks require consented labelled audio and a live
 * proxy — not present in-repo. Do not switch production finals to turbo
 * without those measurements.
 */

export const STT_FINAL_MODEL = "whisper-large-v3";
export const STT_INTERIM_MODEL = "whisper-large-v3-turbo";

export type ModelBenchmarkRecommendation = {
  keepFinalAsLargeV3: boolean;
  useTurboForInterim: boolean;
  rationale: string[];
  /** What the operator must measure before changing the final default. */
  requiredBeforeSwitch: string[];
};

/**
 * Policy recommendation based on known product constraints (not live samples).
 * Live numbers must come from `[stt-latency]` / `window.__sttLatency.summary()`.
 */
export function recommendSttModelPolicy(input?: {
  /** Measured median final sttRoundTripMs for large-v3 (optional). */
  largeV3MedianMs?: number;
  /** Measured median final sttRoundTripMs for turbo (optional). */
  turboMedianMs?: number;
  /** Measured WER delta turbo − large (positive = turbo worse). */
  turboWerDelta?: number;
}): ModelBenchmarkRecommendation {
  const rationale: string[] = [
    "Interim path already uses whisper-large-v3-turbo for lower time-to-first-text.",
    "Final path keeps whisper-large-v3 for accuracy on short / technical words.",
  ];
  const requiredBeforeSwitch = [
    "Consented labelled WAV set (≥30 utterances) covering mic + meeting.",
    "Paired runs: same audio → large-v3 vs turbo via stt-proxy only.",
    "Report median/p95 sttRoundTripMs, WER, technical-term hit rate, hallucination rate.",
    "Switch final default only if turbo WER delta ≤ ~0.02 absolute and latency gain ≥ ~30%.",
  ];

  let keepFinalAsLargeV3 = true;
  if (
    typeof input?.largeV3MedianMs === "number" &&
    typeof input?.turboMedianMs === "number" &&
    typeof input?.turboWerDelta === "number"
  ) {
    const latencyGain =
      (input.largeV3MedianMs - input.turboMedianMs) / input.largeV3MedianMs;
    const qualityOk = input.turboWerDelta <= 0.02;
    const speedOk = latencyGain >= 0.3;
    keepFinalAsLargeV3 = !(qualityOk && speedOk);
    rationale.push(
      `Measured latency gain turbo vs large: ${(latencyGain * 100).toFixed(0)}%.`,
      `Measured WER delta (turbo − large): ${input.turboWerDelta.toFixed(3)}.`,
      keepFinalAsLargeV3
        ? "Keep large-v3 for finals — quality/latency gate not met."
        : "Turbo meets gates — consider allowlisting turbo as final via VITE_GROQ_STT_MODEL.",
    );
  } else {
    rationale.push(
      "No paired live measurements in-repo — do not change the production final model yet.",
    );
  }

  return {
    keepFinalAsLargeV3,
    useTurboForInterim: true,
    rationale,
    requiredBeforeSwitch,
  };
}
