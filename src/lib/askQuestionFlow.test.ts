import { describe, expect, it } from "vitest";
import { decideAskAudienceQuestion } from "./askQuestionFlow";
import type { ExtractedQuestion } from "./extractAudienceQuestions";

const baseQuestion = (over: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
  questionId: "q1",
  sourceTranscriptId: "t1",
  originalQuestion: "What is the Fibonacci series?",
  displayQuestion: "What is the Fibonacci sequence?",
  confidence: null,
  needsReview: false,
  ...over,
});

describe("decideAskAudienceQuestion", () => {
  const messages = [
    {
      id: "t1",
      speaker: "them" as const,
      content: "What is the Fibonacci series?",
      originalContent: "What is the Fibonacci series?",
    },
    {
      id: "m1",
      speaker: "me" as const,
      content: "We were covering recursion.",
    },
  ];

  it("requires review for needsReview without confirmation", () => {
    const d = decideAskAudienceQuestion({
      question: baseQuestion({ needsReview: true }),
      alreadyAnsweredIds: [],
      submitting: false,
      messages,
    });
    expect(d.action).toBe("require_review");
  });

  it("submits edited text and preserves original in decision metadata", () => {
    const d = decideAskAudienceQuestion({
      question: baseQuestion({ needsReview: true }),
      editedText: "What is the Fibonacci sequence in DP?",
      alreadyAnsweredIds: [],
      submitting: false,
      messages,
    });
    expect(d.action).toBe("submit");
    if (d.action !== "submit") return;
    expect(d.questionText).toBe("What is the Fibonacci sequence in DP?");
    expect(d.originalQuestion).toBe("What is the Fibonacci series?");
    expect(d.prompt).toContain("What is the Fibonacci sequence in DP?");
    expect(d.prompt).toContain("Source transcript:");
    expect(d.prompt).not.toContain("entire meeting");
  });

  it("rejects duplicate submissions", () => {
    const d = decideAskAudienceQuestion({
      question: baseQuestion(),
      alreadyAnsweredIds: ["q1"],
      submitting: false,
      messages,
    });
    expect(d.action).toBe("reject_duplicate");
  });

  it("rejects when already submitting", () => {
    const d = decideAskAudienceQuestion({
      question: baseQuestion(),
      alreadyAnsweredIds: [],
      submitting: true,
      messages,
    });
    expect(d.action).toBe("reject_duplicate");
  });
});
