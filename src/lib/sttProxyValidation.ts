/**
 * Shared STT proxy contract limits (kept in sync with supabase/functions/stt-proxy).
 * Pure helpers — unit-tested without Deno or live Groq.
 */

export const STT_PROXY_MAX_BYTES = 3 * 1024 * 1024; // 3 MiB
export const STT_PROXY_MAX_PROMPT_CHARS = 900; // ~224 Whisper tokens with headroom
export const STT_PROXY_ALLOWED_MODELS = [
  "whisper-large-v3",
  "whisper-large-v3-turbo",
] as const;
export const STT_PROXY_RATE_LIMIT_WINDOW_MS = 60_000;
export const STT_PROXY_RATE_LIMIT_MAX = 30; // per user per window

export const STT_PROXY_ALLOWED_MIME = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/ogg",
  "application/octet-stream",
] as const;

export type SttProxyValidationErrorCode =
  | "missing_file"
  | "file_too_large"
  | "unsupported_mime"
  | "prompt_too_long"
  | "unsupported_model"
  | "rate_limited";

export type SttProxyValidationResult =
  | { ok: true }
  | { ok: false; code: SttProxyValidationErrorCode; message: string };

export function validateSttUpload(input: {
  byteLength: number;
  mimeType: string;
  prompt: string;
  model: string;
}): SttProxyValidationResult {
  if (input.byteLength <= 0) {
    return {
      ok: false,
      code: "missing_file",
      message: "Audio file is required.",
    };
  }
  if (input.byteLength > STT_PROXY_MAX_BYTES) {
    return {
      ok: false,
      code: "file_too_large",
      message: `Audio exceeds maximum size of ${STT_PROXY_MAX_BYTES} bytes.`,
    };
  }
  const mime = (input.mimeType || "").toLowerCase().split(";")[0]!.trim();
  if (
    mime &&
    !STT_PROXY_ALLOWED_MIME.includes(
      mime as (typeof STT_PROXY_ALLOWED_MIME)[number],
    )
  ) {
    return {
      ok: false,
      code: "unsupported_mime",
      message: `Unsupported audio type: ${mime}`,
    };
  }
  if (input.prompt.length > STT_PROXY_MAX_PROMPT_CHARS) {
    return {
      ok: false,
      code: "prompt_too_long",
      message: `Prompt exceeds ${STT_PROXY_MAX_PROMPT_CHARS} characters.`,
    };
  }
  if (
    !STT_PROXY_ALLOWED_MODELS.includes(
      input.model as (typeof STT_PROXY_ALLOWED_MODELS)[number],
    )
  ) {
    return {
      ok: false,
      code: "unsupported_model",
      message: "Unsupported transcription model.",
    };
  }
  return { ok: true };
}

/**
 * Pure sliding-window helper for unit tests only.
 * Production proxies use durable Postgres RPCs (`ai_begin_ai_request`).
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;

  constructor(
    windowMs = STT_PROXY_RATE_LIMIT_WINDOW_MS,
    max = STT_PROXY_RATE_LIMIT_MAX,
  ) {
    this.windowMs = windowMs;
    this.max = max;
  }

  allow(key: string, now = Date.now()): SttProxyValidationResult {
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (prev.length >= this.max) {
      this.hits.set(key, prev);
      return {
        ok: false,
        code: "rate_limited",
        message: "Too many transcription requests. Try again shortly.",
      };
    }
    prev.push(now);
    this.hits.set(key, prev);
    return { ok: true };
  }
}

/** Production must never use a client-bundled Groq key. */
export function shouldAllowDirectGroqStt(env: {
  prod: boolean;
  proxyUrl?: string;
  allowDirectDevFlag?: string;
}): { allow: boolean; reason: string } {
  if (env.proxyUrl) {
    return { allow: false, reason: "proxy_configured" };
  }
  if (env.prod) {
    return { allow: false, reason: "production_requires_proxy" };
  }
  if (env.allowDirectDevFlag === "true") {
    return { allow: true, reason: "explicit_dev_opt_in" };
  }
  return { allow: false, reason: "dev_opt_in_required" };
}
