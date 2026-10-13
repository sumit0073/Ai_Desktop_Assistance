import { describe, expect, it } from "vitest";
import { computeWer, technicalTermHitRate, tokenizeForWer } from "./wer";
import { runSyntheticEval } from "./runEval";

describe("computeWer", () => {
  it("is zero for identical strings", () => {
    expect(
      computeWer(
        "What is the Fibonacci sequence?",
        "What is the Fibonacci sequence?",
      ).wer,
    ).toBe(0);
  });

  it("counts substitutions for wrong technical terms", () => {
    const r = computeWer(
      "Fibonacci sequence",
      "Fibonacci series",
    );
    expect(r.substitutions).toBeGreaterThan(0);
    expect(r.wer).toBeGreaterThan(0);
  });

  it("tokenizes conservatively", () => {
    expect(tokenizeForWer("Big-O, API!")).toEqual(["big", "o", "api"]);
  });
});

describe("technicalTermHitRate", () => {
  it("scores present terms", () => {
    const r = technicalTermHitRate(
      "binary search has logarithmic time complexity",
      ["binary search", "time complexity", "hash map"],
    );
    expect(r.hits).toContain("binary search");
    expect(r.misses).toContain("hash map");
    expect(r.hitRate).toBeCloseTo(2 / 3);
  });
});

describe("runSyntheticEval", () => {
  it("reports synthetic-only results and does not claim real-world measurement", () => {
    const report = runSyntheticEval();
    expect(report.kind).toBe("synthetic");
    expect(report.realWorldMeasured).toBe(false);
    expect(report.disclaimer.toLowerCase()).toContain("unmeasured");
    expect(report.cases.length).toBeGreaterThan(5);
    const thanks = report.cases.find((c) => c.id === "hallucination-thank-you");
    expect(thanks?.wer).toBe(0);
  });
});
