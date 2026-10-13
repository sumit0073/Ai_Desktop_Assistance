import { sanitizeTranscript } from "./sanitizeTranscript";
import { shouldAllowDirectGroqStt } from "./sttProxyValidation";
import { buildWhisperPrompt } from "./sttVocabulary";
import { isSupabaseConfigured, supabase } from "./supabase";

const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
/** Full large-v3: better WER than turbo for short / uncommon words. */
const DEFAULT_STT_MODEL = "whisper-large-v3";
/** Faster model for live interim (partial) transcripts while speaking. */
const INTERIM_STT_MODEL = "whisper-large-v3-turbo";

/**
 * SECURITY:
 * - Production MUST use `VITE_STT_PROXY_URL` (Supabase Edge Function `stt-proxy`).
 * - Direct Groq calls require explicit `VITE_ALLOW_DIRECT_GROQ_STT=true` in DEV only.
 * - Never ship `VITE_GROQ_API_KEY` in production builds.
 * - See docs/stt-security.md
 */

export type TranscriptResult = {
  /** Raw provider text before hallucination filtering (never LLM-rewritten). */
  originalText: string;
  /** UI-safe text after silence/hallucination filters; "" means skip bubble. */
  text: string;
};

export type TranscribeOptions = {
  /** Recent finalized same-source transcript text for Whisper continuation. */
  recentTranscript?: string;
  /** Prefer turbo model for live partials while the user is still speaking. */
  interim?: boolean;
  signal?: AbortSignal;
  /** Optional access token override (tests). */
  accessToken?: string;
};

/** DEV-only — never read outside import.meta.env.DEV so production DCE can drop the key. */
function getClientDevApiKey(): string | undefined {
  if (!import.meta.env.DEV) return undefined;
  const key =
    (import.meta.env.VITE_GROQ_API_KEY as string | undefined) ||
    (import.meta.env.VITE_XAI_API_KEY as string | undefined);
  if (
    !key ||
    key === "your-groq-api-key" ||
    key === "your-xai-api-key" ||
    key.trim().length < 10
  ) {
    return undefined;
  }
  return key.trim();
}

export function getSttProxyUrl(): string | undefined {
  const url = (import.meta.env.VITE_STT_PROXY_URL as string | undefined)?.trim();
  return url || undefined;
}

function getSttModel(interim?: boolean): string {
  if (interim) return INTERIM_STT_MODEL;
  return (
    (import.meta.env.VITE_GROQ_STT_MODEL as string | undefined)?.trim() ||
    DEFAULT_STT_MODEL
  );
}

function getSttLanguage(): string | undefined {
  const lang = (
    import.meta.env.VITE_STT_LANGUAGE as string | undefined
  )?.trim();
  return lang || "en";
}

function extensionForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

async function resolveAccessToken(
  override?: string,
): Promise<string> {
  if (override?.trim()) return override.trim();
  if (!supabase || !isSupabaseConfigured) {
    throw new Error(
      "Supabase Auth is required for speech-to-text. Sign in, or configure VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.",
    );
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error("Could not read auth session for speech-to-text.");
  }
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Sign in to use speech-to-text.");
  }
  return token;
}

async function parseTranscriptResponse(
  response: Response,
): Promise<TranscriptResult> {
  if (!response.ok) {
    let detail = `Transcription failed (${response.status}).`;
    try {
      const body = (await response.json()) as {
        error?: { message?: string };
        message?: string;
      };
      if (body.error?.message) detail = body.error.message;
      else if (body.message) detail = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  const data = (await response.json()) as { text?: string };
  const originalText = (data.text ?? "").trim();
  const text = sanitizeTranscript(originalText);
  return { originalText, text };
}

async function transcribeViaProxy(
  file: File,
  prompt: string,
  options?: TranscribeOptions,
): Promise<TranscriptResult> {
  const proxyUrl = getSttProxyUrl();
  if (!proxyUrl) {
    throw new Error("VITE_STT_PROXY_URL is not configured.");
  }

  const accessToken = await resolveAccessToken(options?.accessToken);
  const form = new FormData();
  form.append("file", file);
  form.append("model", getSttModel(options?.interim));
  form.append("prompt", prompt);
  const language = getSttLanguage();
  if (language) form.append("language", language);

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(anonKey ? { apikey: anonKey } : {}),
    },
    body: form,
    signal: options?.signal,
  });

  return parseTranscriptResponse(response);
}

async function transcribeViaDirectGroqDev(
  file: File,
  prompt: string,
  options?: TranscribeOptions,
): Promise<TranscriptResult> {
  const apiKey = getClientDevApiKey();
  if (!apiKey) {
    throw new Error(
      "Direct Groq STT requires VITE_GROQ_API_KEY plus VITE_ALLOW_DIRECT_GROQ_STT=true (local development only).",
    );
  }

  const form = new FormData();
  form.append("file", file);
  form.append("model", getSttModel(options?.interim));
  form.append("response_format", "json");
  form.append("temperature", "0");
  const language = getSttLanguage();
  if (language) form.append("language", language);
  form.append("prompt", prompt);

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal: options?.signal,
  });

  return parseTranscriptResponse(response);
}

/**
 * Upload audio for transcription.
 * Production: authenticated Supabase `stt-proxy` only (no client Groq key).
 * Development: proxy preferred; direct Groq only with explicit opt-in.
 */
export async function transcribeAudioBlob(
  blob: Blob,
  options?: TranscribeOptions,
): Promise<TranscriptResult> {
  const mime = blob.type || "audio/webm";
  const file = new File([blob], `capture.${extensionForMime(mime)}`, {
    type: mime,
  });
  const prompt = buildWhisperPrompt({
    recentTranscript: options?.recentTranscript,
  });

  const proxyUrl = getSttProxyUrl();
  const directGate = shouldAllowDirectGroqStt({
    prod: import.meta.env.PROD,
    proxyUrl,
    allowDirectDevFlag: import.meta.env.VITE_ALLOW_DIRECT_GROQ_STT as
      | string
      | undefined,
  });

  if (proxyUrl) {
    return transcribeViaProxy(file, prompt, options);
  }

  if (import.meta.env.PROD) {
    throw new Error(
      "Production speech-to-text requires VITE_STT_PROXY_URL (authenticated server proxy). Direct Groq keys are not allowed in production builds. See docs/stt-security.md.",
    );
  }

  if (!directGate.allow) {
    throw new Error(
      "Speech-to-text is not configured. Set VITE_STT_PROXY_URL, or for local development only set VITE_ALLOW_DIRECT_GROQ_STT=true and VITE_GROQ_API_KEY. See docs/stt-security.md.",
    );
  }

  return transcribeViaDirectGroqDev(file, prompt, options);
}
