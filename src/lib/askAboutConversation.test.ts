import { describe, expect, it } from "vitest";
import { looksLikeArchitecture } from "./architectureDetect";
import {
  ASK_AI_CONTEXT_TURNS,
  buildAskAboutConversationPrompt,
  buildPromptFromSelection,
  formatRecentConversationForAi,
  selectAskAiTarget,
  selectLatestTranscriptQuestion,
} from "./askAboutConversation";

const chatterThenHld = [
  { id: "1", speaker: "them" as const, content: "Hello guys, how are you doing today?" },
  { id: "2", speaker: "them" as const, content: "So basically," },
  { id: "3", speaker: "them" as const, content: "We can promptly say" },
  { id: "4", speaker: "them" as const, content: "It is not accurate but it's okay." },
  { id: "5", speaker: "them" as const, content: "What do you think about API?" },
  { id: "6", speaker: "them" as const, content: "What is HLD and LLD?" },
];

describe("formatRecentConversationForAi", () => {
  it(`keeps only the last ${ASK_AI_CONTEXT_TURNS} usable Them/You turns`, () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      speaker: (i % 2 === 0 ? "them" : "me") as "them" | "me",
      content: `What is topic number ${i}?`,
    }));
    const text = formatRecentConversationForAi(messages);
    expect(text).not.toContain("topic number 0");
    expect(text).toContain("topic number 7");
    expect(text.split("\n\n").length).toBeLessThanOrEqual(ASK_AI_CONTEXT_TURNS);
  });

  it("ignores assistant, welcome, noise fragments, and duplicates", () => {
    const text = formatRecentConversationForAi([
      { id: "welcome", speaker: "assistant", content: "hi" },
      { id: "a1", speaker: "assistant", content: "old answer" },
      { id: "n1", speaker: "them", content: "So basically," },
      { id: "t1", speaker: "them", content: "what is DP?" },
      { id: "t1b", speaker: "them", content: "what is DP?" },
      { id: "m1", speaker: "me", content: "I think memoization" },
    ]);
    expect(text).toContain("Them: what is DP?");
    expect(text).toContain("Me: I think memoization");
    expect(text).not.toContain("old answer");
    expect(text).not.toContain("So basically");
    expect(text.match(/what is DP/gi)?.length).toBe(1);
  });
});

describe("selectLatestTranscriptQuestion", () => {
  it("picks the latest interviewer question over earlier chatter", () => {
    const selected = selectLatestTranscriptQuestion(chatterThenHld);
    expect(selected?.question.toLowerCase()).toMatch(/hld.*lld|lld.*hld/);
    expect(selected?.source).toBe("them");
  });

  it("does not invent a question from incomplete fragments alone", () => {
    expect(
      selectLatestTranscriptQuestion([
        { id: "1", speaker: "them", content: "So basically," },
        { id: "2", speaker: "them", content: "We can promptly say" },
      ]),
    ).toBeNull();
  });

  it("prefers Them over Me when both have questions", () => {
    const selected = selectLatestTranscriptQuestion([
      { id: "1", speaker: "them", content: "What is recursion?" },
      { id: "2", speaker: "me", content: "What should I answer?" },
    ]);
    // Newest Them wins over later Me when scanning Them first... 
    // Implementation scans all Them newest-first, then Me.
    expect(selected?.question.toLowerCase()).toContain("recursion");
    expect(selected?.source).toBe("them");
  });
});

describe("selectAskAiTarget / buildPromptFromSelection", () => {
  it("latest HLD/LLD question wins and does not activate architecture generation", () => {
    const selection = selectAskAiTarget({ messages: chatterThenHld });
    expect(selection.question?.toLowerCase()).toMatch(/hld/);
    expect(selection.mode).toBe("direct_question");
    const prompt = buildPromptFromSelection(selection);
    expect(prompt).toContain("Question:");
    expect(prompt).toMatch(/Do NOT produce Mermaid diagrams/i);
    expect(looksLikeArchitecture(prompt)).toBe(false);
  });

  it("composer note overrides transcript chatter", () => {
    const selection = selectAskAiTarget({
      messages: chatterThenHld,
      note: "What is mitochondria?",
    });
    expect(selection.question).toBe("What is mitochondria?");
    expect(selection.diagnostics.questionSource).toBe("composer");
    const prompt = buildPromptFromSelection(selection);
    expect(prompt).toContain("Question: What is mitochondria?");
    expect(prompt).toContain("Optional context");
  });

  it("follow-up questions keep prior context", () => {
    const selection = selectAskAiTarget({
      messages: [
        {
          id: "1",
          speaker: "them",
          content: "How does a load balancer distribute traffic?",
        },
        { id: "2", speaker: "them", content: "Why?" },
      ],
      note: "",
    });
    // "Why?" may be selected as follow_up or the longer prior if Why fails extraction.
    const prompt = buildPromptFromSelection(selection);
    expect(prompt.toLowerCase()).toMatch(/why|load balancer/);
    expect(selection.context.toLowerCase()).toContain("load balancer");
  });

  it("clarify mode when only noise is present", () => {
    const selection = selectAskAiTarget({
      messages: [
        { id: "1", speaker: "them", content: "So basically," },
        { id: "2", speaker: "me", content: "okay" },
      ],
    });
    // Noise filtered from context → may be empty or clarify
    expect(["clarify", "empty"]).toContain(selection.mode);
    const prompt = buildPromptFromSelection(selection);
    expect(prompt.toLowerCase()).toMatch(/clarif|no clear/);
    expect(prompt.toLowerCase()).not.toContain("e-commerce");
  });
});

describe("buildAskAboutConversationPrompt", () => {
  it("prioritizes typed note over a wrong STT transcript (legacy string path)", () => {
    const prompt = buildAskAboutConversationPrompt({
      note: "What is mitochondria?",
      transcript: "Me: what is my phone call",
    });
    expect(prompt).toContain("Question: What is mitochondria?");
    expect(prompt).toContain("Respond only to the Question above");
    expect(prompt).toMatch(/never let it override the Question/i);
  });

  it("uses messages path to select latest question", () => {
    const prompt = buildAskAboutConversationPrompt({
      messages: chatterThenHld,
    });
    expect(prompt.toLowerCase()).toMatch(/hld/);
    expect(prompt).toMatch(/Respond only to the Question above/);
    expect(looksLikeArchitecture(prompt)).toBe(false);
  });

  it("returns clarify guidance when there is no usable question", () => {
    const prompt = buildAskAboutConversationPrompt({
      messages: [{ id: "1", speaker: "them", content: "So basically," }],
    });
    expect(prompt.toLowerCase()).toMatch(/clarif|no clear/);
  });
});

describe("architecture activation via Ask AI prompts", () => {
  it("definition question does not look like architecture generation", () => {
    expect(looksLikeArchitecture("What is HLD and LLD?")).toBe(false);
    expect(
      looksLikeArchitecture(
        buildPromptFromSelection(selectAskAiTarget({ messages: chatterThenHld })),
      ),
    ).toBe(false);
  });

  it("explicit design request still activates architecture", () => {
    expect(
      looksLikeArchitecture(
        "Design an e-commerce order management system",
      ),
    ).toBe(true);
    const prompt = buildAskAboutConversationPrompt({
      note: "Design an e-commerce order management system",
    });
    expect(looksLikeArchitecture(prompt)).toBe(true);
  });
});
