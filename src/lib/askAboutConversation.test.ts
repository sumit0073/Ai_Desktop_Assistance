import { describe, expect, it } from "vitest";
import {
  ASK_AI_CONTEXT_TURNS,
  buildAskAboutConversationPrompt,
  formatRecentConversationForAi,
} from "./askAboutConversation";

describe("formatRecentConversationForAi", () => {
  it(`keeps only the last ${ASK_AI_CONTEXT_TURNS} Them/You turns`, () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      speaker: (i % 2 === 0 ? "them" : "me") as "them" | "me",
      content: `line ${i}`,
    }));
    const text = formatRecentConversationForAi(messages);
    expect(text).not.toContain("line 0");
    expect(text).not.toContain("line 1");
    expect(text).toContain("line 7");
    expect(text.split("\n\n")).toHaveLength(ASK_AI_CONTEXT_TURNS);
  });

  it("ignores assistant and welcome bubbles", () => {
    const text = formatRecentConversationForAi([
      { id: "welcome", speaker: "assistant", content: "hi" },
      { id: "a1", speaker: "assistant", content: "old answer" },
      { id: "t1", speaker: "them", content: "what is DP?" },
      { id: "m1", speaker: "me", content: "I think memoization" },
    ]);
    expect(text).toBe("Them: what is DP?\n\nMe: I think memoization");
    expect(text).not.toContain("old answer");
  });
});

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
