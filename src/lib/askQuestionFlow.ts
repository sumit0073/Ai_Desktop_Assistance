import type { ExtractedQuestion } from "./extractAudienceQuestions";

export type TranscriptLike = {
  id: string;
  content: string;
  originalContent?: string;
  speaker: "them" | "me" | "assistant";
};

export type AskQuestionDecision =
  | { action: "require_review"; question: ExtractedQuestion }
  | { action: "reject_empty" }
  | { action: "reject_duplicate"; questionId: string }
  | {
      action: "submit";
      questionId: string;
      questionText: string;
      originalQuestion: string;
      sourceTranscriptId: string;
      prompt: string;
    };

/**
 * Pure decision helper for question-chip click / edit / confirm.
 * Keeps original question text separate from the submitted display text.
 */
export function decideAskAudienceQuestion(input: {
  question: ExtractedQuestion;
  editedText?: string;
  alreadyAnsweredIds: string[];
  /** True when a submit is already in flight. */
  submitting: boolean;
  messages: TranscriptLike[];
  nearbyLimit?: number;
}): AskQuestionDecision {
  const { question, editedText, alreadyAnsweredIds, submitting, messages } =
    input;
  if (submitting) {
    return { action: "reject_duplicate", questionId: question.questionId };
  }
  if (alreadyAnsweredIds.includes(question.questionId)) {
    return { action: "reject_duplicate", questionId: question.questionId };
  }

  const confirmed = Boolean(editedText?.trim());
  if (question.needsReview && !confirmed) {
    return { action: "require_review", question };
  }

  const questionText = (editedText ?? question.displayQuestion).trim();
  if (!questionText) return { action: "reject_empty" };

  const nearbyLimit = input.nearbyLimit ?? 4;
  const sourceMsg = messages.find((m) => m.id === question.sourceTranscriptId);
  const nearby = messages
    .filter((m) => m.id !== "welcome" && m.content.trim())
    .slice(-nearbyLimit)
    .map((m) => {
      const who =
        m.speaker === "them"
          ? "Audience"
          : m.speaker === "me"
            ? "You"
            : "Assistant";
      return `${who}: ${m.content}`;
    })
    .join("\n");

  const sourceLine = sourceMsg
    ? `Source transcript: ${sourceMsg.originalContent ?? sourceMsg.content}`
    : `Original question span: ${question.originalQuestion}`;

  const prompt =
    `Answer this audience question clearly and helpfully.\n\n` +
    `Question: ${questionText}\n\n` +
    `${sourceLine}\n\n` +
    (nearby
      ? `Nearby conversation context:\n${nearby}\n\nRespond only to the question above.`
      : `Respond only to the question above.`);

  return {
    action: "submit",
    questionId: question.questionId,
    questionText,
    originalQuestion: question.originalQuestion,
    sourceTranscriptId: question.sourceTranscriptId,
    prompt,
  };
}
