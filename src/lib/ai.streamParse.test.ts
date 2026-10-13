import { describe, expect, it } from "vitest";
import { extractStreamDeltaText } from "./aiStreamParse";

describe("extractStreamDeltaText", () => {
  it("reads standard delta.content", () => {
    expect(
      extractStreamDeltaText({
        choices: [{ delta: { content: "Hello" } }],
      }),
    ).toBe("Hello");
  });

  it("falls back to gpt-oss reasoning when content is empty", () => {
    expect(
      extractStreamDeltaText({
        choices: [{ delta: { content: "", reasoning: "Mitochondria are" } }],
      }),
    ).toBe("Mitochondria are");
  });

  it("prefers content over reasoning when both exist", () => {
    expect(
      extractStreamDeltaText({
        choices: [
          { delta: { content: "Final answer", reasoning: "scratchpad" } },
        ],
      }),
    ).toBe("Final answer");
  });

  it("returns empty string when nothing usable is present", () => {
    expect(extractStreamDeltaText({ choices: [{ delta: {} }] })).toBe("");
  });
});
