import { describe, expect, it } from "vitest";
import { applyLiveUtteranceUpdate } from "./liveUtteranceUpdate";

describe("applyLiveUtteranceUpdate", () => {
  it("replaces clipped interim with complete final (HLD/LLD case)", () => {
    const interim = applyLiveUtteranceUpdate({
      incomingText: "And LLD.",
      isPartial: true,
      sameUtterance: false,
      utteranceAlreadyFinalized: false,
    });
    expect(interim.apply).toBe(true);
    expect(interim.text).toBe("And LLD.");

    const final = applyLiveUtteranceUpdate({
      incomingText: "What is HLD and LLD?",
      isPartial: false,
      sameUtterance: true,
      utteranceAlreadyFinalized: false,
    });
    expect(final.apply).toBe(true);
    expect(final.text).toBe("What is HLD and LLD?");
    // Must not concatenate.
    expect(final.text).not.toContain("And LLD.What");
  });

  it("ignores late interim after the utterance was finalized", () => {
    const late = applyLiveUtteranceUpdate({
      incomingText: "And LLD.",
      isPartial: true,
      sameUtterance: true,
      utteranceAlreadyFinalized: true,
    });
    expect(late.apply).toBe(false);
  });

  it("does not invent a merge across unrelated utterances", () => {
    const next = applyLiveUtteranceUpdate({
      incomingText: "Can you explain scalability?",
      isPartial: false,
      sameUtterance: false,
      utteranceAlreadyFinalized: false,
    });
    expect(next.text).toBe("Can you explain scalability?");
  });

  it("clears empty discarded interim without locking the final", () => {
    const empty = applyLiveUtteranceUpdate({
      incomingText: "   ",
      isPartial: true,
      sameUtterance: true,
      utteranceAlreadyFinalized: false,
    });
    expect(empty.apply).toBe(false);
    expect(empty.clear).toBe(true);
  });
});
