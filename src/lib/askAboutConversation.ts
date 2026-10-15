/** How many Them/You turns to send as Ask AI context (not the full thread). */
export const ASK_AI_CONTEXT_TURNS = 5;

export type AskConversationTurn = {
  id?: string;
  speaker: "them" | "me" | "assistant";
  content: string;
  streaming?: boolean;
};

/** Last N audience/you lines only — used as hidden model context. */
export function formatRecentConversationForAi(
  messages: AskConversationTurn[],
  limit = ASK_AI_CONTEXT_TURNS,
): string {
  return messages
    .filter(
      (m) =>
        m.id !== "welcome" &&
        Boolean(m.content.trim()) &&
        !m.streaming &&
        (m.speaker === "them" || m.speaker === "me"),
    )
    .slice(-limit)
    .map((m) =>
      m.speaker === "them"
        ? `Them: ${m.content.trim()}`
        : `Me: ${m.content.trim()}`,
    )
    .join("\n\n");
}

/**
 * Build the Ask AI prompt for the composer / Ctrl+Enter path.
 * An explicit typed (or composer) note always wins over transcript STT noise.
 */
export function buildAskAboutConversationPrompt(input: {
  note?: string;
  transcript?: string;
}): string {
  const note = input.note?.trim() ?? "";
  const transcript = input.transcript?.trim() ?? "";

  if (note && transcript) {
    return (
      `Answer this question from me clearly and helpfully.\n\n` +
      `Question: ${note}\n\n` +
      `Optional conversation context (Them = audience, Me = me). ` +
      `Speech-to-text in the transcript may be wrong — never let it override the Question.\n\n` +
      `${transcript}\n\n` +
      `Respond only to the Question above.`
    );
  }
  if (note) return note;
  if (transcript) {
    return (
      `Here is the conversation transcript (Them = audience, Me = me):\n\n${transcript}\n\n` +
      `Help with the open questions and give a useful next answer.`
    );
  }
  return "Help with this conversation.";
}
