import { describe, expect, it } from "vitest";
import {
  isMicBleedFromAudience,
  isWhisperHallucination,
  sanitizeTranscript,
} from "./sanitizeTranscript";

describe("sanitizeTranscript", () => {
  it("strips common Whisper thank-you hallucinations", () => {
    expect(sanitizeTranscript("Thank you.")).toBe("");
    expect(sanitizeTranscript("Thanks for watching!")).toBe("");
    expect(sanitizeTranscript("  thank you  ")).toBe("");
  });

  it("keeps real speech", () => {
    expect(sanitizeTranscript("Can you explain the API gateway?")).toBe(
      "Can you explain the API gateway?",
    );
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

  it("flags courtesy hallucinations but keeps short real answers", () => {
    expect(isWhisperHallucination("Thank you")).toBe(true);
    expect(isWhisperHallucination("Yes")).toBe(false);
    expect(isWhisperHallucination("No")).toBe(false);
    expect(isWhisperHallucination("Why")).toBe(false);
    expect(isWhisperHallucination("What is CAP theorem?")).toBe(false);
  });
});
