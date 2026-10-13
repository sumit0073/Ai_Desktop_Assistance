import { describe, expect, it } from "vitest";
import {
  isMicBleedFromAudience,
  isWhisperHallucination,
  sanitizeTranscript,
  sanitizeTranscriptDetailed,
  transcriptOverlapRatio,
} from "./sanitizeTranscript";

describe("sanitizeTranscript", () => {
  it("always strips YouTube-style / tag hallucinations", () => {
    expect(sanitizeTranscript("Thanks for watching!")).toBe("");
    expect(sanitizeTranscript("Please like and subscribe")).toBe("");
    expect(sanitizeTranscript("[Music]")).toBe("");
  });

  it("drops thank-you under weak/unknown evidence (silence hallucinations)", () => {
    expect(sanitizeTranscript("Thank you.")).toBe("");
    expect(sanitizeTranscript("  thank you  ", { speechEvidence: "marginal" })).toBe(
      "",
    );
    expect(sanitizeTranscript("You are welcome.", { speechEvidence: "unknown" })).toBe(
      "",
    );
  });

  it("keeps genuine thank-you when acoustic evidence is strong", () => {
    expect(
      sanitizeTranscript("Thank you.", { speechEvidence: "strong" }),
    ).toBe("Thank you.");
    expect(
      sanitizeTranscript("You're welcome", { speechEvidence: "strong" }),
    ).toBe("You're welcome");
  });

  it("keeps real speech and short answers", () => {
    expect(sanitizeTranscript("Can you explain the API gateway?")).toBe(
      "Can you explain the API gateway?",
    );
    expect(isWhisperHallucination("Yes")).toBe(false);
    expect(isWhisperHallucination("No")).toBe(false);
    expect(isWhisperHallucination("Why")).toBe(false);
    expect(
      sanitizeTranscript("Yes", { speechEvidence: "marginal" }),
    ).toBe("Yes");
  });

  it("rejects repeated weak-evidence phrases", () => {
    const r = sanitizeTranscriptDetailed("Thank you.", {
      speechEvidence: "marginal",
      recentSameSource: ["Thank you."],
    });
    expect(r.text).toBe("");
    expect(r.reason).toBe("weak_evidence_courtesy");
  });

  it("detects mic bleed from recent audience text", () => {
    expect(
      isMicBleedFromAudience("How does Redis work?", [
        "How does Redis work?",
      ]),
    ).toBe(true);
    expect(
      isMicBleedFromAudience("I think we should use Redis.", [
        "How does Redis work?",
      ]),
    ).toBe(false);
  });

  it("detects bleed when Whisper wording differs slightly", () => {
    expect(
      isMicBleedFromAudience("what is the fibonacci sequence", [
        "What is the Fibonacci sequence?",
      ]),
    ).toBe(true);
    expect(
      transcriptOverlapRatio(
        "explain binary search please",
        "Can you explain binary search?",
      ),
    ).toBeGreaterThan(0.4);
  });
});
