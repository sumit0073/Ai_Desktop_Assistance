/**
 * Configurable technical vocabulary for Groq Whisper `prompt` biasing.
 * Whisper uses this for spelling/context hints only — it must not invent words.
 *
 * Override via VITE_STT_VOCABULARY (comma-separated) without code changes.
 */

export const DEFAULT_TECH_VOCABULARY = [
  "Fibonacci sequence",
  "Fibonacci series",
  "recursion",
  "iteration",
  "binary search",
  "dynamic programming",
  "time complexity",
  "space complexity",
  "Big O",
  "arrays",
  "linked lists",
  "graphs",
  "trees",
  "hash map",
  "SQL",
  "API",
  "REST",
  "GraphQL",
  "TypeScript",
  "JavaScript",
  "Python",
  "Rust",
  "Java",
  "Go",
  "Kafka",
  "Redis",
  "PostgreSQL",
  "microservices",
  "load balancer",
  "API gateway",
] as const;

/** Max prompt budget for vocabulary terms (Whisper prompt ≈ 224 tokens). */
const MAX_VOCAB_CHARS = 420;
const MAX_CONTEXT_CHARS = 280;

export function loadConfiguredVocabulary(): string[] {
  const fromEnv = (
    import.meta.env.VITE_STT_VOCABULARY as string | undefined
  )?.trim();
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 48);
  }
  return [...DEFAULT_TECH_VOCABULARY];
}

/**
 * Build a Groq/OpenAI-compatible Whisper prompt:
 * - static vocabulary spelling hints (never fed from live transcripts)
 * - optional recent same-source transcript continuation (separate field)
 *
 * Groq documents `prompt` as style/spelling/context guidance (≈224 tokens),
 * not a forced dictionary. Untrusted transcript text must never be merged
 * into the vocabulary list.
 */
export function buildWhisperPrompt(options?: {
  /** Same-source rolling context only — see SttRollingContext. */
  recentTranscript?: string;
  vocabulary?: string[];
}): string {
  // Vocabulary is always the configured static list (or explicit override).
  // Live transcripts are never appended here.
  const vocab = (options?.vocabulary ?? loadConfiguredVocabulary()).filter(
    (term) => term.trim().length > 0,
  );
  let vocabBlock = vocab.join(", ");
  if (vocabBlock.length > MAX_VOCAB_CHARS) {
    vocabBlock = `${vocabBlock.slice(0, MAX_VOCAB_CHARS).replace(/,\s*[^,]*$/, "")}…`;
  }

  let recent = (options?.recentTranscript ?? "").replace(/\s+/g, " ").trim();
  if (recent.length > MAX_CONTEXT_CHARS) {
    recent = recent.slice(-MAX_CONTEXT_CHARS);
    const cut = recent.indexOf(" ");
    if (cut > 0 && cut < 40) recent = recent.slice(cut + 1);
  }

  // Keep domain framing light: heavy "interview/CS" prompts bias Whisper and
  // can mangle everyday / science words (e.g. mitochondria → unrelated phrases).
  const parts = [
    "Transcribe only clear speech accurately; leave empty if none.",
    "Write the exact words spoken. Do not invent a different topic.",
    `Spelling hints if those words are actually heard: ${vocabBlock}.`,
  ];
  if (recent) {
    parts.push(`Previous transcript context: ${recent}`);
  }
  return parts.join(" ");
}
