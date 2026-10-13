/**
 * Whisper often invents short courtesy lines on silence, noise, or speaker bleed
 * into the mic (e.g. "Thank you.", "Thanks for watching.").
 */

const HALLUCINATION_EXACT = new Set(
  [
    "thank you",
    "thank you.",
    "thanks",
    "thanks.",
    "thanks you",
    "thank you very much",
    "thank you very much.",
    "thanks for watching",
    "thanks for watching.",
    "thank you for watching",
    "thank you for watching.",
    "thanks for listening",
    "thanks for listening.",
    "thank you for listening",
    "thank you for listening.",
    "bye",
    "bye.",
    "goodbye",
    "goodbye.",
    // Keep real short answers (yes / no / why) — do not list them here.
    "um",
    "uh",
    "hmm",
    "mm",
    "mm-hmm",
    "subscribe",
    "please subscribe",
    ".",
    "...",
  ].map((s) => s.toLowerCase()),
);

/** Normalize for comparison: lowercase, collapse space, strip most punctuation. */
export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the whole clip is a known Whisper hallucination / empty filler. */
export function isWhisperHallucination(text: string): boolean {
  const n = normalizeTranscript(text);
  if (!n) return true;
  if (HALLUCINATION_EXACT.has(n)) return true;
  // Short courtesy-only lines Whisper invents on quiet slices.
  if (/^(thank(s| you)|thanks for (watching|listening))( .*)?$/i.test(n) && n.split(" ").length <= 6) {
    return true;
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
): boolean {
  const mic = normalizeTranscript(micText);
  if (!mic || mic.length < 4) return false;

  for (const audience of recentAudience) {
    const them = normalizeTranscript(audience);
    if (!them) continue;
    if (mic === them) return true;
    if (them.includes(mic) && mic.length >= 8) return true;
    if (mic.includes(them) && them.length >= 8) return true;
  }
  return false;
}

/** Return cleaned text, or "" if it should not be shown in the chat. */
export function sanitizeTranscript(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (isWhisperHallucination(trimmed)) return "";
  return trimmed;
}
