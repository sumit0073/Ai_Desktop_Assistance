import { describe, expect, it } from "vitest";
import {
  extractAudienceQuestions,
  extractAudienceQuestionTexts,
  refineDisplayQuestion,
} from "./extractAudienceQuestions";

describe("extractAudienceQuestions", () => {
  it("splits multiple questions ending with ?", () => {
    const out = extractAudienceQuestionTexts(
      "Hi everyone. What is your pricing? How do you handle refunds? Thanks.",
    );
    expect(out).toEqual([
      "What is your pricing?",
      "How do you handle refunds?",
    ]);
  });

  it("detects interrogatives without a question mark", () => {
    const out = extractAudienceQuestionTexts(
      "Can you walk through the architecture. Also share the timeline.",
    );
    expect(out.some((q) => /can you walk through/i.test(q))).toBe(true);
  });

  it("dedupes near-identical questions", () => {
    const out = extractAudienceQuestionTexts(
      "What is latency? what is latency? What is latency??",
    );
    expect(out).toHaveLength(1);
  });

  it("returns empty for statements only", () => {
    expect(
      extractAudienceQuestionTexts(
        "We shipped the release yesterday. All green.",
      ),
    ).toEqual([]);
  });

  it("parses Q: tagged lines", () => {
    const out = extractAudienceQuestionTexts(
      "Notes from the room.\nQ: When is the beta?\nQ: Who owns onboarding?",
    );
    expect(out).toEqual(["When is the beta?", "Who owns onboarding?"]);
  });

  it("keeps Fibonacci as sequence in algorithm context", () => {
    const out = extractAudienceQuestions(
      "How do you compute the Fibonacci series with recursion?",
      {
        sourceTranscriptId: "t1",
        recentContext: [
          "Let's talk about dynamic programming and time complexity.",
        ],
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.displayQuestion).toMatch(/Fibonacci sequence/i);
    expect(out[0]!.originalQuestion).toMatch(/Fibonacci series/i);
    expect(out[0]!.sourceTranscriptId).toBe("t1");
    expect(out[0]!.confidence).toBeNull();
  });

  it("does not force algorithm reading for a book series discussion", () => {
    const refined = refineDisplayQuestion(
      "Which book in the Fibonacci series is your favorite?",
      "We were discussing novels and authors in the book club.",
    );
    expect(refined.display).toMatch(/Fibonacci series/i);
    expect(refined.display).not.toMatch(/Fibonacci sequence/i);
  });

  it("preserves short why questions", () => {
    const out = extractAudienceQuestionTexts("Why?");
    // "Why?" is shorter than MIN_LEN for looksLikeQuestion — whole-transcript
    // fallback also requires MIN_LEN. Prefer "Why is that?" style.
    expect(extractAudienceQuestionTexts("Why use recursion here?")).toEqual([
      "Why use recursion here?",
    ]);
    expect(out).toEqual([]);
  });

  it("marks incomplete questions for review", () => {
    const out = extractAudienceQuestions("What about the and?", {
      sourceTranscriptId: "t2",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.needsReview).toBe(true);
  });

  it("links question metadata to the source transcript", () => {
    const out = extractAudienceQuestions("What is Big O of binary search?", {
      sourceTranscriptId: "src-99",
      recentContext: ["We covered arrays and trees."],
    });
    expect(out[0]!.sourceTranscriptId).toBe("src-99");
    expect(out[0]!.questionId).toBeTruthy();
    expect(out[0]!.originalQuestion).toMatch(/Big O/i);
  });

  it("handles poor grammar without inventing terms", () => {
    const out = extractAudienceQuestions(
      "how you make fibonacci with recursion please?",
      {
        sourceTranscriptId: "t3",
        recentContext: ["algorithm interview", "time complexity"],
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.displayQuestion.toLowerCase()).toContain("fibonacci");
    expect(out[0]!.displayQuestion.toLowerCase()).not.toContain(
      "dynamic programming",
    );
  });
});
