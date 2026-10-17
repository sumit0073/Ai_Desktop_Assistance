/**
 * Ctrl+Enter / Ask AI: select the latest interviewer question and build a
 * direct-answer prompt. Does not dump raw turns as if they were the question.
 */

import { extractAudienceQuestions } from "./extractAudienceQuestions";

/** How many Them/You turns to keep as supporting context (not the question). */
export const ASK_AI_CONTEXT_TURNS = 5;

export type AskConversationTurn = {
  id?: string;
  speaker: "them" | "me" | "assistant";
  content: string;
  streaming?: boolean;
};

export type AskAiAnswerMode =
  | "direct_question"
  | "composer_note"
  | "follow_up"
  | "clarify"
  | "empty";

export type AskAiSelection = {
  /** Primary question the model must answer (null → clarify). */
  question: string | null;
  /** Supporting Them/You lines (formatted), never treated as the task itself. */
  context: string;
  mode: AskAiAnswerMode;
  /** Privacy-safe diagnostics (no full transcript dump). */
  diagnostics: {
    questionChars: number;
    contextChars: number;
    contextTurnCount: number;
    questionSource: "composer" | "them" | "me" | "none";
    answerMode: AskAiAnswerMode;
  };
};

const FOLLOW_UP =
  /^(?:why|how\s+so|and\s+then|what\s+about(?:\s+that)?|can\s+you\s+explain(?:\s+that)?(?:\s+further)?|explain(?:\s+that)?(?:\s+further)?|go\s+on|continue|more\s+detail|tell\s+me\s+more)\??$/i;

const NOISE_ONLY =
  /^(?:so\s+basically|we\s+can\s+promptly\s+say|um+|uh+|hmm+|okay|ok|yeah|yes|no|right|alright)[,.]?$/i;

function isUsableTurn(m: AskConversationTurn): boolean {
  return (
    m.id !== "welcome" &&
    Boolean(m.content.trim()) &&
    !m.streaming &&
    (m.speaker === "them" || m.speaker === "me")
  );
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isNoiseFragment(text: string): boolean {
  const t = normalizeLine(text);
  if (!t) return true;
  if (t.length < 8) return true;
  if (NOISE_ONLY.test(t)) return true;
  // Trailing dangling connectors without a real clause.
  if (/\b(and|or|but|so|because|like|um|uh)\s*$/i.test(t) && t.split(/\s+/).length <= 4) {
    return true;
  }
  return false;
}

function dedupeConsecutive(turns: AskConversationTurn[]): AskConversationTurn[] {
  const out: AskConversationTurn[] = [];
  for (const t of turns) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.speaker === t.speaker &&
      normalizeLine(prev.content).toLowerCase() ===
        normalizeLine(t.content).toLowerCase()
    ) {
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Last N audience/you lines only — used as hidden model context. */
export function formatRecentConversationForAi(
  messages: AskConversationTurn[],
  limit = ASK_AI_CONTEXT_TURNS,
): string {
  return dedupeConsecutive(messages.filter(isUsableTurn))
    .filter((m) => !isNoiseFragment(m.content))
    .slice(-limit)
    .map((m) =>
      m.speaker === "them"
        ? `Them: ${normalizeLine(m.content)}`
        : `Me: ${normalizeLine(m.content)}`,
    )
    .join("\n\n");
}

/**
 * Pick the latest complete interviewer (Them) question; fall back to Me.
 * Does not invent wording — uses extractAudienceQuestions / raw interrogatives.
 */
export function selectLatestTranscriptQuestion(
  messages: AskConversationTurn[],
): { question: string; source: "them" | "me" } | null {
  const turns = dedupeConsecutive(messages.filter(isUsableTurn));
  // Prefer Them (meeting / interviewer), scan newest → oldest.
  for (const speaker of ["them", "me"] as const) {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i]!;
      if (turn.speaker !== speaker) continue;
      const content = normalizeLine(turn.content);
      if (isNoiseFragment(content)) continue;

      const extracted = extractAudienceQuestions(content, {
        sourceTranscriptId: turn.id ?? `turn-${i}`,
      });
      const complete = extracted.find((q) => !q.needsReview);
      if (complete) {
        return { question: complete.displayQuestion, source: speaker };
      }
      // Incomplete extraction: still allow a clear interrogative line.
      if (
        extracted.length === 0 &&
        /\?/.test(content) &&
        content.length >= 12 &&
        content.length <= 200
      ) {
        return {
          question: /[?？]$/.test(content) ? content : `${content}?`,
          source: speaker,
        };
      }
      // First extracted even if needsReview — better than inventing.
      if (extracted[0] && extracted[0].displayQuestion.length >= 8) {
        return { question: extracted[0].displayQuestion, source: speaker };
      }
    }
  }
  return null;
}

function isFollowUpQuestion(text: string): boolean {
  return FOLLOW_UP.test(normalizeLine(text).replace(/[.!]+$/, ""));
}

/**
 * Resolve what Ctrl+Enter should ask, with supporting context only.
 */
export function selectAskAiTarget(input: {
  messages: AskConversationTurn[];
  note?: string;
}): AskAiSelection {
  const note = input.note?.trim() ?? "";
  const context = formatRecentConversationForAi(input.messages);
  const contextTurnCount = context
    ? context.split(/\n\n+/).filter(Boolean).length
    : 0;

  const diagBase = {
    contextChars: context.length,
    contextTurnCount,
  };

  if (note) {
    const mode: AskAiAnswerMode = isFollowUpQuestion(note)
      ? "follow_up"
      : "composer_note";
    return {
      question: note,
      context,
      mode,
      diagnostics: {
        ...diagBase,
        questionChars: note.length,
        questionSource: "composer",
        answerMode: mode,
      },
    };
  }

  const selected = selectLatestTranscriptQuestion(input.messages);
  if (selected) {
    const mode: AskAiAnswerMode = isFollowUpQuestion(selected.question)
      ? "follow_up"
      : "direct_question";
    return {
      question: selected.question,
      context,
      mode,
      diagnostics: {
        ...diagBase,
        questionChars: selected.question.length,
        questionSource: selected.source,
        answerMode: mode,
      },
    };
  }

  if (context) {
    return {
      question: null,
      context,
      mode: "clarify",
      diagnostics: {
        ...diagBase,
        questionChars: 0,
        questionSource: "none",
        answerMode: "clarify",
      },
    };
  }

  return {
    question: null,
    context: "",
    mode: "empty",
    diagnostics: {
      questionChars: 0,
      contextChars: 0,
      contextTurnCount: 0,
      questionSource: "none",
      answerMode: "empty",
    },
  };
}

const DIRECT_ANSWER_RULES =
  `Answer rules:\n` +
  `- Answer the Question directly in the first sentence.\n` +
  `- Be concise, clear, and technically accurate — easy to skim in an interview.\n` +
  `- Use Optional context only to interpret the Question; never replace it with a different task.\n` +
  `- Do NOT invent requirements (e.g. e-commerce platforms) that were not asked.\n` +
  `- Do NOT produce Mermaid diagrams or a complete system-design write-up ` +
  `unless the Question explicitly asks you to design or draw one.\n` +
  `- Speech-to-text in the context may be wrong — never invent missing words in the Question.`;

/**
 * Build the Ask AI prompt for the composer / Ctrl+Enter path.
 * An explicit typed (or composer) note always wins over transcript STT noise.
 */
export function buildAskAboutConversationPrompt(input: {
  note?: string;
  transcript?: string;
  /** Prefer structured selection when messages are available. */
  messages?: AskConversationTurn[];
}): string {
  // New path: structured selection from messages (+ optional note).
  if (input.messages) {
    const selection = selectAskAiTarget({
      messages: input.messages,
      note: input.note,
    });
    return buildPromptFromSelection(selection);
  }

  // Legacy path (tests / callers with preformatted transcript string).
  const note = input.note?.trim() ?? "";
  const transcript = input.transcript?.trim() ?? "";

  if (note && transcript) {
    return (
      `Answer this question from me clearly and helpfully.\n\n` +
      `Question: ${note}\n\n` +
      `Optional conversation context (Them = audience, Me = me). ` +
      `Speech-to-text in the transcript may be wrong — never let it override the Question.\n\n` +
      `${transcript}\n\n` +
      `${DIRECT_ANSWER_RULES}\n` +
      `Respond only to the Question above.`
    );
  }
  if (note) {
    return (
      `Question: ${note}\n\n${DIRECT_ANSWER_RULES}\nRespond only to the Question above.`
    );
  }
  if (transcript) {
    // Best-effort: treat last Them/Me interrogative line inside the blob.
    const fakeTurns = transcript.split(/\n\n+/).map((block, i) => {
      const them = block.match(/^Them:\s*([\s\S]+)$/i);
      const me = block.match(/^Me:\s*([\s\S]+)$/i);
      if (them) {
        return {
          id: `t${i}`,
          speaker: "them" as const,
          content: them[1]!.trim(),
        };
      }
      if (me) {
        return { id: `m${i}`, speaker: "me" as const, content: me[1]!.trim() };
      }
      return { id: `x${i}`, speaker: "them" as const, content: block.trim() };
    });
    return buildPromptFromSelection(
      selectAskAiTarget({ messages: fakeTurns, note: "" }),
    );
  }
  return "Help with this conversation.";
}

export function buildPromptFromSelection(selection: AskAiSelection): string {
  if (selection.mode === "empty") {
    return (
      "No clear question was found in the recent conversation. " +
      "Ask me to clarify what I want answered — do not invent a system-design task."
    );
  }

  if (selection.mode === "clarify" || !selection.question) {
    const ctx = selection.context
      ? `\n\nRecent conversation (may contain STT errors):\n${selection.context}\n\n`
      : "\n\n";
    return (
      `No clear interviewer question was identified.${ctx}` +
      `Reply in 1–2 short sentences asking which question I should answer. ` +
      `Do not invent a product, architecture, or diagram.`
    );
  }

  const followUpNote =
    selection.mode === "follow_up"
      ? `\nThis looks like a follow-up — use Optional context to resolve what "that" / prior topic refers to.\n`
      : "";

  const contextBlock = selection.context
    ? `\nOptional context (Them = interviewer/audience, Me = me; STT may be wrong):\n${selection.context}\n`
    : "";

  return (
    `Answer this question clearly and helpfully.\n\n` +
    `Question: ${selection.question}\n` +
    followUpNote +
    contextBlock +
    `\n${DIRECT_ANSWER_RULES}\n` +
    `Respond only to the Question above.`
  );
}

/** DEV-only Ask AI diagnostics. Production builds never call this with content. */
export function logAskAiDiagnostics(
  selection: AskAiSelection,
  extra?: {
    model?: string;
    requestId?: string;
    latencyMs?: number;
    architectureMode?: boolean;
  },
): void {
  if (!import.meta.env.DEV) return;
  console.debug("[ask-ai]", {
    selectedQuestion: selection.question,
    contextChars: selection.diagnostics.contextChars,
    contextTurnCount: selection.diagnostics.contextTurnCount,
    answerMode: selection.diagnostics.answerMode,
    questionSource: selection.diagnostics.questionSource,
    architectureMode: extra?.architectureMode ?? false,
    model: extra?.model,
    requestId: extra?.requestId,
    latencyMs: extra?.latencyMs,
  });
}
