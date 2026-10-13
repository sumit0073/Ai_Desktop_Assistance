/**
 * Shared chat proxy contract limits (keep in sync with supabase/functions/chat-proxy).
 * Pure helpers — unit-tested without Deno or live Groq.
 */

export const CHAT_PROXY_ALLOWED_MODELS = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
] as const;

export const CHAT_PROXY_MAX_MESSAGES = 20;
/** Aggregate plain-text characters across all messages (excl. image payloads). */
export const CHAT_PROXY_MAX_TEXT_CHARS = 120_000;
/** Max characters of a single data-URL / base64 image payload. ~1.5 MiB binary. */
export const CHAT_PROXY_MAX_IMAGE_CHARS = 2_100_000;
export const CHAT_PROXY_MAX_IMAGES = 2;
export const CHAT_PROXY_RATE_LIMIT_WINDOW_MS = 60_000;
export const CHAT_PROXY_RATE_LIMIT_MAX = 40;
export const CHAT_PROXY_MIN_TEMPERATURE = 0;
export const CHAT_PROXY_MAX_TEMPERATURE = 1;

export type ChatProxyRole = "system" | "user" | "assistant";

export type ChatProxyContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatProxyMessage = {
  role: ChatProxyRole;
  content: string | ChatProxyContentPart[];
};

export type ChatProxyValidationErrorCode =
  | "missing_messages"
  | "too_many_messages"
  | "invalid_role"
  | "invalid_content"
  | "text_too_long"
  | "image_too_large"
  | "too_many_images"
  | "unsupported_image"
  | "unsupported_model"
  | "invalid_temperature"
  | "stream_required"
  | "rate_limited";

export type ChatProxyValidationResult =
  | { ok: true; textChars: number; imageCount: number }
  | { ok: false; code: ChatProxyValidationErrorCode; message: string };

const ALLOWED_ROLES = new Set<string>(["system", "user", "assistant"]);

function isDataImageUrl(url: string): boolean {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}

export function validateChatProxyRequest(input: {
  messages: unknown;
  model: unknown;
  temperature?: unknown;
  stream?: unknown;
}): ChatProxyValidationResult {
  // Client always sends stream:true; reject explicit false. Omitted is OK.
  if (input.stream === false) {
    return {
      ok: false,
      code: "stream_required",
      message: "Only streaming chat completions are supported.",
    };
  }

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    return {
      ok: false,
      code: "missing_messages",
      message: "messages array is required.",
    };
  }
  if (input.messages.length > CHAT_PROXY_MAX_MESSAGES) {
    return {
      ok: false,
      code: "too_many_messages",
      message: `At most ${CHAT_PROXY_MAX_MESSAGES} messages are allowed.`,
    };
  }

  const model =
    typeof input.model === "string" ? input.model.trim() : "";
  if (
    !CHAT_PROXY_ALLOWED_MODELS.includes(
      model as (typeof CHAT_PROXY_ALLOWED_MODELS)[number],
    )
  ) {
    return {
      ok: false,
      code: "unsupported_model",
      message: "Unsupported chat model.",
    };
  }

  if (input.temperature !== undefined && input.temperature !== null) {
    const t = Number(input.temperature);
    if (
      !Number.isFinite(t) ||
      t < CHAT_PROXY_MIN_TEMPERATURE ||
      t > CHAT_PROXY_MAX_TEMPERATURE
    ) {
      return {
        ok: false,
        code: "invalid_temperature",
        message: "temperature must be between 0 and 1.",
      };
    }
  }

  let textChars = 0;
  let imageCount = 0;

  for (const raw of input.messages) {
    if (!raw || typeof raw !== "object") {
      return {
        ok: false,
        code: "invalid_content",
        message: "Each message must be an object.",
      };
    }
    const msg = raw as { role?: unknown; content?: unknown };
    if (typeof msg.role !== "string" || !ALLOWED_ROLES.has(msg.role)) {
      return {
        ok: false,
        code: "invalid_role",
        message: "Invalid message role.",
      };
    }

    if (typeof msg.content === "string") {
      textChars += msg.content.length;
      continue;
    }

    if (!Array.isArray(msg.content) || msg.content.length === 0) {
      return {
        ok: false,
        code: "invalid_content",
        message: "Message content must be a string or non-empty parts array.",
      };
    }

    for (const part of msg.content) {
      if (!part || typeof part !== "object") {
        return {
          ok: false,
          code: "invalid_content",
          message: "Invalid content part.",
        };
      }
      const p = part as {
        type?: unknown;
        text?: unknown;
        image_url?: { url?: unknown };
      };
      if (p.type === "text") {
        if (typeof p.text !== "string") {
          return {
            ok: false,
            code: "invalid_content",
            message: "Text part requires a string.",
          };
        }
        textChars += p.text.length;
        continue;
      }
      if (p.type === "image_url") {
        const url =
          typeof p.image_url?.url === "string" ? p.image_url.url : "";
        if (!url || !isDataImageUrl(url)) {
          return {
            ok: false,
            code: "unsupported_image",
            message:
              "Images must be data:image/png|jpeg|webp;base64,... URLs only.",
          };
        }
        if (url.length > CHAT_PROXY_MAX_IMAGE_CHARS) {
          return {
            ok: false,
            code: "image_too_large",
            message: "Image payload exceeds size limit.",
          };
        }
        imageCount += 1;
        continue;
      }
      return {
        ok: false,
        code: "invalid_content",
        message: "Unsupported content part type.",
      };
    }
  }

  if (textChars > CHAT_PROXY_MAX_TEXT_CHARS) {
    return {
      ok: false,
      code: "text_too_long",
      message: `Message text exceeds ${CHAT_PROXY_MAX_TEXT_CHARS} characters.`,
    };
  }
  if (imageCount > CHAT_PROXY_MAX_IMAGES) {
    return {
      ok: false,
      code: "too_many_images",
      message: `At most ${CHAT_PROXY_MAX_IMAGES} images are allowed.`,
    };
  }

  return { ok: true, textChars, imageCount };
}

/**
 * Pure sliding-window helper for unit tests only.
 * Production proxies use durable Postgres RPCs (`ai_begin_ai_request`).
 */
export class ChatSlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;

  constructor(
    windowMs = CHAT_PROXY_RATE_LIMIT_WINDOW_MS,
    max = CHAT_PROXY_RATE_LIMIT_MAX,
  ) {
    this.windowMs = windowMs;
    this.max = max;
  }

  allow(key: string, now = Date.now()): ChatProxyValidationResult {
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (prev.length >= this.max) {
      this.hits.set(key, prev);
      return {
        ok: false,
        code: "rate_limited",
        message: "Too many chat requests. Try again shortly.",
      };
    }
    prev.push(now);
    this.hits.set(key, prev);
    return { ok: true, textChars: 0, imageCount: 0 };
  }
}

/** Production must never use a client-bundled Groq key for chat. */
export function shouldAllowDirectGroqChat(env: {
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
