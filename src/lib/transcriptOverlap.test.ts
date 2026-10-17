import { describe, expect, it } from "vitest";
import {
  reconcileSegmentOverlap,
  stripSegmentOverlap,
} from "./transcriptOverlap";

describe("reconcileSegmentOverlap", () => {
  it("does not strip a full question that only shares a short tail with a clipped interim", () => {
    // Live UI replaces same-utterance text; if a *new* segment arrived with
    // these texts, short overlap (<4 words) must not corrupt the full question.
    const result = reconcileSegmentOverlap(
      {
        text: "And LLD.",
        source: "microphone",
        sessionId: "s1",
        startedAtMs: 0,
        endedAtMs: 900,
      },
      {
        text: "What is HLD and LLD?",
        source: "microphone",
        sessionId: "s1",
        startedAtMs: 0,
        endedAtMs: 2200,
      },
    );
    expect(result.reason).toBe("insufficient_overlap");
    expect(result.text).toBe("What is HLD and LLD?");
  });

  it("trims overlapping prefix when same source, session, and timing abut", () => {
    const result = reconcileSegmentOverlap(
      {
        text: "We should use the Fibonacci sequence for this",
        source: "meeting",
        sessionId: "s1",
        startedAtMs: 0,
        endedAtMs: 4000,
      },
      {
        text: "Fibonacci sequence for this and then talk about memoization",
        source: "meeting",
        sessionId: "s1",
        startedAtMs: 3800,
        endedAtMs: 8000,
      },
    );
    expect(result.reason).toBe("applied");
    expect(result.text).toBe("and then talk about memoization");
  });

  it("never trims across microphone and meeting sources", () => {
    const result = reconcileSegmentOverlap(
      {
        text: "Fibonacci sequence for this example",
        source: "microphone",
        sessionId: "s1",
        startedAtMs: 0,
        endedAtMs: 3000,
      },
      {
        text: "Fibonacci sequence for this example continues",
        source: "meeting",
        sessionId: "s1",
        startedAtMs: 2800,
        endedAtMs: 6000,
      },
    );
    expect(result.reason).toBe("cross_source");
    expect(result.text).toContain("continues");
  });

  it("never trims across sessions", () => {
    const result = reconcileSegmentOverlap(
      {
        text: "same words here again today",
        source: "meeting",
        sessionId: "s1",
        startedAtMs: 0,
        endedAtMs: 2000,
      },
      {
        text: "same words here again today and more",
        source: "meeting",
        sessionId: "s2",
        startedAtMs: 1800,
        endedAtMs: 4000,
      },
    );
    expect(result.reason).toBe("cross_session");
  });

  it("preserves genuine repetition without timing evidence", () => {
    const result = reconcileSegmentOverlap(
      {
        text: "yes yes we need tests",
        source: "meeting",
        sessionId: "s1",
      },
      {
        text: "yes yes we need tests again",
        source: "meeting",
        sessionId: "s1",
      },
    );
    expect(result.reason).toBe("no_timing_evidence");
    expect(result.text).toBe("yes yes we need tests again");
  });

  it("drops exact duplicate segments", () => {
    const result = reconcileSegmentOverlap(
      {
        text: "Hello there everyone",
        source: "meeting",
        sessionId: "s1",
        startedAtMs: 0,
        endedAtMs: 1000,
      },
      {
        text: "Hello there everyone",
        source: "meeting",
        sessionId: "s1",
        startedAtMs: 0,
        endedAtMs: 1000,
      },
    );
    expect(result.text).toBe("");
    expect(result.reason).toBe("same_segment");
  });

  it("does not trim when timestamps are far apart", () => {
    const result = reconcileSegmentOverlap(
      {
        text: "time complexity of binary search matters",
        source: "meeting",
        sessionId: "s1",
        startedAtMs: 0,
        endedAtMs: 2000,
      },
      {
        text: "time complexity of binary search matters a lot",
        source: "meeting",
        sessionId: "s1",
        startedAtMs: 20_000,
        endedAtMs: 24_000,
      },
    );
    expect(result.reason).toBe("no_timing_evidence");
    expect(result.trimmed).toBe(false);
  });
});

describe("stripSegmentOverlap (legacy)", () => {
  it("only drops exact duplicates", () => {
    expect(stripSegmentOverlap("Hello", "Hello")).toBe("");
    expect(stripSegmentOverlap("Hello world", "Hello world again")).toBe(
      "Hello world again",
    );
  });
});
