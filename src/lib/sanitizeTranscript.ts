/**
 * Whisper often invents short courtesy lines on silence, noise, or speaker bleed
 * into the mic (e.g. "Thank you.", "You are welcome.", "Thanks for watching.").
 *
 * Courtesy phrases that can also be real speech ("thank you", "yes") are only
 * dropped when acoustic evidence is weak/unknown — never blindly rejected.
 */

export type SpeechEvidenceTier = "strong" | "marginal" | "unknown";

export type SanitizeTranscriptOptions = {
  /**
   * From native segment validation. `unknown` when the browser path has no
   * acoustic summary (composer mic) — treat courtesy phrases conservatively.
   */
  speechEvidence?: SpeechEvidenceTier;
  /**
   * Recent same-source UI texts (finals). Used to drop repeated silence
   * hallucinations without inventing a confidence score.
   */
  recentSameSource?: string[];
};

/** Never valid as a sole meeting/mic utterance (YouTube / filler tags). */
const ALWAYS_HALLUCINATION_EXACT = new Set(
  [
    "thanks for watching",
    "thanks for watching.",
    "thank you for watching",
    "thank you for watching.",
    "thanks for listening",
    "thanks for listening.",
    "thank you for listening",
    "thank you for listening.",
    "thanks for tuning in",
    "please subscribe",
    "subscribe",
    "like and subscribe",
    "please like and subscribe",
    "don't forget to subscribe",
    "see you in the next video",
    "um",
    "uh",
    "hmm",
    "mm",
    "mm-hmm",
    ".",
    "...",
    "music",
    "applause",
    "laughter",
    "[music]",
    "[applause]",
    "[laughter]",
    "[silence]",
    "silence",
  ].map((s) => s.toLowerCase()),
);

const ALWAYS_HALLUCINATION_PATTERNS: RegExp[] = [
  /^(thanks? for (watching|listening|tuning in))( .*)?$/i,
  /^(please )?(like and )?subscribe( .*)?$/i,
  /^see you in the next( video)?\.?$/i,
  /^\[?(music|applause|laughter|silence)\]?\.?$/i,
];

/**
 * Can be real speech — only drop when evidence is not strong
 * (or when repeating during weak evidence).
 */
const EVIDENCE_GATED_EXACT = new Set(
  [
    "thank you",
    "thank you.",
    "thanks",
    "thanks.",
    "thanks you",
    "thank you very much",
    "thank you very much.",
    "thanks for coming",
    "you are welcome",
    "you are welcome.",
    "you're welcome",
    "you're welcome.",
    "you re welcome",
    "welcome",
    "welcome.",
    "my pleasure",
    "my pleasure.",
    "no problem",
    "no problem.",
    "no worries",
    "no worries.",
    "anytime",
    "any time",
    "see you",
    "see you.",
    "see you later",
    "see you next time",
    "bye",
    "bye.",
    "bye bye",
    "goodbye",
    "goodbye.",
    "good bye",
    "take care",
    "take care.",
    "have a nice day",
    "have a great day",
    "peace",
    "peace.",
    "amen",
    "amen.",
  ].map((s) => s.toLowerCase()),
);

const EVIDENCE_GATED_PATTERNS: RegExp[] = [
  /^(thank(s| you)|thank you very much)\.?$/i,
  /^(you('?re| are) welcome)\.?$/i,
  /^(no problem|no worries|my pleasure|anytime|any time)\.?$/i,
  /^see you( (later|next time))?\.?$/i,
  /^(bye|goodbye|good bye)( bye)?\.?$/i,
  /^(have a (nice|great|good) day)\.?$/i,
  /^(take care|welcome|peace|amen)\.?$/i,
];

/** Normalize for comparison: lowercase, collapse space, strip most punctuation. */
export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(text: string): string[] {
  return normalizeTranscript(text)
    .split(" ")
    .filter((w) => w.length >= 3);
}

/**
 * Word-level overlap ratio (Jaccard on significant tokens).
 * Used when Whisper wording differs slightly between mic bleed and loopback.
 */
export function transcriptOverlapRatio(a: string, b: string): number {
  const aw = new Set(significantWords(a));
  const bw = new Set(significantWords(b));
  if (aw.size === 0 || bw.size === 0) return 0;
  let inter = 0;
  for (const w of aw) {
    if (bw.has(w)) inter += 1;
  }
  const union = aw.size + bw.size - inter;
  return union === 0 ? 0 : inter / union;
}

function matchesAlwaysHallucination(n: string): boolean {
  if (ALWAYS_HALLUCINATION_EXACT.has(n)) return true;
  return ALWAYS_HALLUCINATION_PATTERNS.some((re) => re.test(n));
}

function matchesEvidenceGated(n: string): boolean {
  if (EVIDENCE_GATED_EXACT.has(n)) return true;
  return EVIDENCE_GATED_PATTERNS.some((re) => re.test(n));
}

/**
 * True when the whole clip is a known Whisper hallucination / empty filler.
 * Pass `speechEvidence: "strong"` to keep real "thank you" / short courtesy.
 */
export function isWhisperHallucination(
  text: string,
  options?: SanitizeTranscriptOptions,
): boolean {
  const n = normalizeTranscript(text);
  if (!n) return true;
  if (matchesAlwaysHallucination(n)) return true;

  const evidence = options?.speechEvidence ?? "unknown";
  if (matchesEvidenceGated(n) && evidence !== "strong") {
    return true;
  }

  // Repeated identical short phrases under weak evidence → silence loop.
  if (evidence !== "strong" && n.split(" ").length <= 6) {
    const recent = options?.recentSameSource ?? [];
    for (const prev of recent) {
      if (normalizeTranscript(prev) === n) return true;
    }
  }

  return false;
}

/**
 * Drop mic text that is basically the same as recent audience (speaker) text —
 * acoustic bleed from the room speakers into the microphone.
 */
export function isMicBleedFromAudience(
  micText: string,
  recentAudience: string[],
  options?: { minOverlap?: number },
): boolean {
  const mic = normalizeTranscript(micText);
  if (!mic || mic.length < 4) return false;
  const minOverlap = options?.minOverlap ?? 0.55;
  const micWords = significantWords(mic);

  for (const audience of recentAudience) {
    const them = normalizeTranscript(audience);
    if (!them) continue;
    if (mic === them) return true;
    if (them.includes(mic) && mic.length >= 8) return true;
    if (mic.includes(them) && them.length >= 8) return true;

    if (micWords.length >= 3) {
      const ratio = transcriptOverlapRatio(mic, them);
      if (ratio >= minOverlap) return true;
    }
  }
  return false;
}

export type SanitizeResult = {
  text: string;
  rejected: boolean;
  reason?:
    | "empty"
    | "always_hallucination"
    | "weak_evidence_courtesy"
    | "repeated_weak_phrase";
};

/** Classify + clean; "" text means do not show a bubble. */
export function sanitizeTranscriptDetailed(
  text: string,
  options?: SanitizeTranscriptOptions,
): SanitizeResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: "", rejected: true, reason: "empty" };
  }
  const n = normalizeTranscript(trimmed);
  if (!n) {
    return { text: "", rejected: true, reason: "empty" };
  }
  if (matchesAlwaysHallucination(n)) {
    return { text: "", rejected: true, reason: "always_hallucination" };
  }
  const evidence = options?.speechEvidence ?? "unknown";
  if (matchesEvidenceGated(n) && evidence !== "strong") {
    return { text: "", rejected: true, reason: "weak_evidence_courtesy" };
  }
  if (evidence !== "strong" && n.split(" ").length <= 6) {
    const recent = options?.recentSameSource ?? [];
    for (const prev of recent) {
      if (normalizeTranscript(prev) === n) {
        return { text: "", rejected: true, reason: "repeated_weak_phrase" };
      }
    }
  }
  return { text: trimmed, rejected: false };
}

/** Return cleaned text, or "" if it should not be shown in the chat. */
export function sanitizeTranscript(
  text: string,
  options?: SanitizeTranscriptOptions,
): string {
  return sanitizeTranscriptDetailed(text, options).text;
}
