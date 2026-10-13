/**
 * Pull distinct audience questions out of a finalized speech transcript.
 * Heuristic + light domain context (offline). Does not invent missing speech.
 */

export type ExtractedQuestion = {
  questionId: string;
  sourceTranscriptId: string;
  /** Verbatim clause from the transcript (or closest raw span). */
  originalQuestion: string;
  /** Conservative display form (punctuation only unless meaning is clear). */
  displayQuestion: string;
  /**
   * Always null — we do not fabricate calibrated confidence.
   * Use `needsReview` for uncertainty instead.
   */
  confidence: null;
  needsReview: boolean;
};

const INTERROGATIVE =
  /^(?:what|why|how|when|where|who|whom|which|whose|can|could|would|should|will|is|are|am|was|were|do|does|did|have|has|had|may|might|shall|needn't|mustn't|won't|aren't|isn't|don't|doesn't|didn't|haven't|hasn't|hadn't)\b/i;

const MAX_QUESTIONS = 8;
const MIN_LEN = 8;
const MAX_LEN = 160;

/** Signals that the meeting is in an algorithms / CS interview register. */
const ALGO_CONTEXT =
  /\b(algorithm|recursion|recursive|iteration|iterate|binary search|dynamic programming|\bdp\b|time complexity|space complexity|big[- ]?o|leetcode|coding|fibonacci|linked list|hash ?map|graph|tree|array|stack|queue|memoization|complexity)\b/i;

/** Signals that "series" likely means books/media, not algorithms. */
const BOOK_SERIES_CONTEXT =
  /\b(book|novel|author|chapter|trilogy|saga|harry potter|lord of the rings|tv series|netflix|season|episode|fiction)\b/i;

function cleanClause(raw: string): string {
  return raw
    .replace(/^[\s"'“”‘’\-–—•·]+/, "")
    .replace(/^\s*q(?:uestion)?\s*[:.)-]\s*/i, "")
    .replace(/[\s"'“”‘’]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(q: string): string {
  return q.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function ensureQuestionMark(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[?？]$/.test(t) ? t : `${t}?`;
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_LEN) return false;
  if (/[?？]/.test(t)) return true;
  return INTERROGATIVE.test(t);
}

function isIncomplete(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_LEN) return true;
  // Trailing dangling connectors / cut-off speech.
  if (/\b(and|or|but|so|because|like|um|uh)\??$/i.test(t.replace(/\?$/, ""))) {
    return true;
  }
  // Very short interrogative fragments: "What about?" 
  const words = t.replace(/[?？]/g, "").trim().split(/\s+/);
  if (words.length <= 2 && !/^(yes|no|why)\??$/i.test(t)) return true;
  return false;
}

/**
 * Light domain-aware display normalization.
 * Does not invent topics; only clarifies Fibonacci wording when CS context is present
 * and book-series context is absent.
 */
export function refineDisplayQuestion(
  original: string,
  contextBlob: string,
): { display: string; needsReview: boolean } {
  let display = ensureQuestionMark(cleanClause(original));
  let needsReview = isIncomplete(display);

  const ctx = `${contextBlob}\n${original}`;
  const algo = ALGO_CONTEXT.test(ctx);
  const books = BOOK_SERIES_CONTEXT.test(ctx);

  // Prefer algorithm reading of "Fibonacci series" when CS context is strong
  // and there is no book/media evidence.
  if (algo && !books) {
    display = display.replace(
      /\bfibonacci\s+series\b/gi,
      "Fibonacci sequence",
    );
  }

  // If both algo and book signals appear, keep original wording and mark review.
  if (algo && books && /\bfibonacci\b/i.test(original)) {
    needsReview = true;
  }

  // Ambiguous "series" without fibonacci + mixed context → review.
  if (
    /\bseries\b/i.test(original) &&
    !/\bfibonacci\b/i.test(original) &&
    algo &&
    books
  ) {
    needsReview = true;
  }

  if (display.length > MAX_LEN) {
    display = ensureQuestionMark(`${display.slice(0, MAX_LEN - 1).trim()}…`);
    needsReview = true;
  }

  return { display, needsReview };
}

function newQuestionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export type ExtractQuestionsOptions = {
  sourceTranscriptId: string;
  /** Nearby finalized transcripts for domain disambiguation (not rewritten into the question). */
  recentContext?: string[];
};

/**
 * Extract structured questions from a finalized transcript.
 * Returns [] when no reliable question is found.
 */
export function extractAudienceQuestions(
  transcript: string,
  options?: ExtractQuestionsOptions,
): ExtractedQuestion[] {
  const source = transcript.replace(/\r\n/g, "\n").trim();
  if (!source) return [];

  const sourceTranscriptId =
    options?.sourceTranscriptId ?? "unknown-transcript";
  const contextBlob = [
    ...(options?.recentContext ?? []),
    source,
  ].join("\n");

  const chunks = source
    .split(/(?<=[?？])\s+|(?<=[.!])\s+|\n+/)
    .map(cleanClause)
    .filter(Boolean);

  const tagged = source.match(
    /(?:^|\n)\s*(?:q(?:uestion)?\s*[:.)-]\s*)(.+?)(?=\n|$)/gi,
  );
  if (tagged) {
    for (const line of tagged) {
      const body = cleanClause(
        line.replace(/^\s*q(?:uestion)?\s*[:.)-]\s*/i, ""),
      );
      if (body) chunks.push(body);
    }
  }

  const out: ExtractedQuestion[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    if (!looksLikeQuestion(raw)) return;
    const originalQuestion = cleanClause(raw);
    if (!originalQuestion) return;
    const { display, needsReview } = refineDisplayQuestion(
      originalQuestion,
      contextBlob,
    );
    const key = normalizeKey(display);
    if (!key || seen.has(key)) return;
    // Reject display forms that inject unsupported jargon not in the original
    // (except the Fibonacci series→sequence clarification above).
    const injected =
      /\bdynamic programming\b/i.test(display) &&
      !/\bdynamic programming\b/i.test(originalQuestion) &&
      !/\bdp\b/i.test(originalQuestion);
    if (injected) return;

    seen.add(key);
    out.push({
      questionId: newQuestionId(),
      sourceTranscriptId,
      originalQuestion: ensureQuestionMark(originalQuestion),
      displayQuestion: display,
      confidence: null,
      needsReview,
    });
  };

  for (const chunk of chunks) {
    push(chunk);
    if (out.length >= MAX_QUESTIONS) break;
  }

  if (out.length === 0 && looksLikeQuestion(source) && source.length <= MAX_LEN) {
    push(source);
  }

  return out;
}

/** Display strings only (tests / simple callers). */
export function extractAudienceQuestionTexts(transcript: string): string[] {
  return extractAudienceQuestions(transcript, {
    sourceTranscriptId: "legacy",
  }).map((q) => q.displayQuestion);
}
