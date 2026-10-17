import { describe, expect, it } from "vitest";
import { recommendSttModelPolicy } from "./sttModelBenchmark";

describe("recommendSttModelPolicy", () => {
  it("keeps large-v3 finals without live measurements", () => {
    const r = recommendSttModelPolicy();
    expect(r.keepFinalAsLargeV3).toBe(true);
    expect(r.useTurboForInterim).toBe(true);
    expect(r.requiredBeforeSwitch.length).toBeGreaterThan(0);
  });

  it("allows turbo finals only when quality and latency gates pass", () => {
    const r = recommendSttModelPolicy({
      largeV3MedianMs: 2000,
      turboMedianMs: 1000,
      turboWerDelta: 0.01,
    });
    expect(r.keepFinalAsLargeV3).toBe(false);
  });

  it("rejects turbo finals when WER regresses", () => {
    const r = recommendSttModelPolicy({
      largeV3MedianMs: 2000,
      turboMedianMs: 900,
      turboWerDelta: 0.08,
    });
    expect(r.keepFinalAsLargeV3).toBe(true);
  });
});
