export type SttContextSource = "microphone" | "meeting";

/** Max finalized segments kept per source for Whisper continuation. */
export const DEFAULT_STT_CONTEXT_SEGMENTS = 3;
/** Soft char cap after join (Whisper prompt budget shares with vocabulary). */
export const DEFAULT_STT_CONTEXT_MAX_CHARS = 240;

export type ContextPushOptions = {
  /** Empty / failed / hallucination-dropped text must not enter context. */
  trusted: boolean;
  /**
   * Uncertain / needs-review text is excluded so one bad recognition
   * cannot reinforce itself on the next segment.
   */
  uncertain?: boolean;
};

/**
 * Per-source rolling STT context. Vocabulary stays separate (see sttVocabulary).
 * Microphone and meeting streams never share context buffers.
 */
export class SttRollingContext {
  private sessionId = "";
  private mic: string[] = [];
  private meeting: string[] = [];
  private readonly maxSegments: number;
  private readonly maxChars: number;

  constructor(
    maxSegments = DEFAULT_STT_CONTEXT_SEGMENTS,
    maxChars = DEFAULT_STT_CONTEXT_MAX_CHARS,
  ) {
    this.maxSegments = Math.max(1, maxSegments);
    this.maxChars = Math.max(40, maxChars);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** Call when recording starts — drops stale session context. */
  reset(sessionId: string): void {
    this.sessionId = sessionId;
    this.mic = [];
    this.meeting = [];
  }

  /** Call when recording stops — prevents later sessions reading old text. */
  clear(): void {
    this.sessionId = "";
    this.mic = [];
    this.meeting = [];
  }

  push(
    source: SttContextSource,
    text: string,
    options: ContextPushOptions,
  ): void {
    if (!this.sessionId) return;
    if (!options.trusted || options.uncertain) return;
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return;

    const bucket = source === "microphone" ? this.mic : this.meeting;
    bucket.push(trimmed);
    while (bucket.length > this.maxSegments) bucket.shift();
  }

  /** Same-source context only — never cross-contaminate mic ↔ meeting. */
  getPromptContext(source: SttContextSource): string {
    if (!this.sessionId) return "";
    const bucket = source === "microphone" ? this.mic : this.meeting;
    let joined = bucket.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length > this.maxChars) {
      joined = joined.slice(-this.maxChars);
      const cut = joined.indexOf(" ");
      if (cut > 0 && cut < 40) joined = joined.slice(cut + 1);
    }
    return joined;
  }

  /** Test / debug helper. */
  snapshot(): { sessionId: string; mic: string[]; meeting: string[] } {
    return {
      sessionId: this.sessionId,
      mic: [...this.mic],
      meeting: [...this.meeting],
    };
  }
}
