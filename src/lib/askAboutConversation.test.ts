import { describe, expect, it } from "vitest";
import { buildAskAboutConversationPrompt } from "./askAboutConversation";

describe("buildAskAboutConversationPrompt", () => {
  it("prioritizes typed note over a wrong STT transcript", () => {
    const prompt = buildAskAboutConversationPrompt({
      note: "What is mitochondria?",
      transcript: "Me: what is my phone call",
    });
    expect(prompt).toContain("Question: What is mitochondria?");
    expect(prompt).toContain("Respond only to the Question above");
    expect(prompt).toMatch(/never let it override the Question/i);
    expect(prompt).not.toMatch(/Help with the open questions/i);
  });

  it("uses transcript-only flow when composer is empty", () => {
    const prompt = buildAskAboutConversationPrompt({
      transcript: "Me: explain recursion",
    });
    expect(prompt).toContain("explain recursion");
    expect(prompt).toMatch(/Help with the open questions/i);
  });

  it("returns the note alone when there is no transcript", () => {
    expect(
      buildAskAboutConversationPrompt({ note: "What is mitochondria?" }),
    ).toBe("What is mitochondria?");
  });
});
