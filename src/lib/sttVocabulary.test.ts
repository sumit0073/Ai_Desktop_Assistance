import { describe, expect, it } from "vitest";
import { buildWhisperPrompt, DEFAULT_TECH_VOCABULARY } from "./sttVocabulary";

describe("buildWhisperPrompt", () => {
  it("includes spelling hints and recent context without interview bias", () => {
    const prompt = buildWhisperPrompt({
      recentTranscript: "We were discussing recursion and binary search.",
      vocabulary: ["Fibonacci sequence", "dynamic programming"],
    });
    expect(prompt).toContain("Fibonacci sequence");
    expect(prompt).toContain("dynamic programming");
    expect(prompt).toContain("Previous transcript context");
    expect(prompt).toContain("recursion and binary search");
    expect(prompt).not.toMatch(/Technical interview/i);
  });

  it("defaults include Fibonacci and complexity terms", () => {
    expect(DEFAULT_TECH_VOCABULARY.join(" ")).toMatch(/Fibonacci/);
    expect(DEFAULT_TECH_VOCABULARY.join(" ")).toMatch(/time complexity/i);
  });

  it("truncates oversized recent context", () => {
    const long = "word ".repeat(200);
    const prompt = buildWhisperPrompt({
      recentTranscript: long,
      vocabulary: ["SQL"],
    });
    expect(prompt.length).toBeLessThan(1200);
  });
});
