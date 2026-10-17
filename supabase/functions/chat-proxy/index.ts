/**
 * Authenticated chat / vision proxy.
 * - Verifies Supabase user JWT (Authorization: Bearer <access_token>)
 * - Durable Postgres rate limits + daily budgets via ai_begin_ai_request
 * - Forwards allowlisted chat.completions to Groq with server-side GROQ_API_KEY
 * - Streams SSE; never logs message bodies or secrets
 *
 * Limits mirrored in src/lib/chatProxyValidation.ts — keep in sync.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  beginAiRequest,
  endAiRequest,
  estimateChatUnits,
  logProxyEvent,
  quotaDenialMessage,
} from "../_shared/aiQuota.ts";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

const ALLOWED_MODELS = new Set(["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]);
const ALLOWED_ROLES = new Set(["system", "user", "assistant"]);
const MAX_MESSAGES = 20;
const MAX_TEXT_CHARS = 120_000;
const MAX_IMAGE_CHARS = 2_100_000;
const MAX_IMAGES = 2;
const MIN_MAX_TOKENS = 256;
const MAX_MAX_TOKENS = 8192;
const DEFAULT_MAX_TOKENS = 2048;
const UPSTREAM_TIMEOUT_MS = 90_000;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-request-id, retry-after",
};

function json(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "x-request-id": requestId,
      ...extraHeaders,
    },
  });
}

function isDataImageUrl(url: string): boolean {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}

type Validated = {
  model: string;
  temperature: number;
  maxTokens: number;
  messages: unknown[];
  textChars: number;
  imageCount: number;
};

function validateBody(body: unknown): { ok: true; value: Validated } | {
  ok: false;
  status: number;
  message: string;
} {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, message: "JSON body is required." };
  }
  const b = body as Record<string, unknown>;

  if (b.stream === false) {
    return {
      ok: false,
      status: 400,
      message: "Only streaming chat completions are supported.",
    };
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, status: 400, message: "messages array is required." };
  }
  if (b.messages.length > MAX_MESSAGES) {
    return {
      ok: false,
      status: 400,
      message: `At most ${MAX_MESSAGES} messages are allowed.`,
    };
  }

  const model = typeof b.model === "string" ? b.model.trim() : "";
  if (!ALLOWED_MODELS.has(model)) {
    return { ok: false, status: 400, message: "Unsupported chat model." };
  }

  let temperature = 0.35;
  if (b.temperature !== undefined && b.temperature !== null) {
    const t = Number(b.temperature);
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      return {
        ok: false,
        status: 400,
        message: "temperature must be between 0 and 1.",
      };
    }
    temperature = t;
  }

  let maxTokens = DEFAULT_MAX_TOKENS;
  if (b.max_tokens !== undefined && b.max_tokens !== null) {
    const n = Number(b.max_tokens);
    if (
      !Number.isFinite(n) ||
      !Number.isInteger(n) ||
      n < MIN_MAX_TOKENS ||
      n > MAX_MAX_TOKENS
    ) {
      return {
        ok: false,
        status: 400,
        message: `max_tokens must be an integer between ${MIN_MAX_TOKENS} and ${MAX_MAX_TOKENS}.`,
      };
    }
    maxTokens = n;
  }

  let textChars = 0;
  let imageCount = 0;

  for (const raw of b.messages) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, status: 400, message: "Each message must be an object." };
    }
    const msg = raw as { role?: unknown; content?: unknown };
    if (typeof msg.role !== "string" || !ALLOWED_ROLES.has(msg.role)) {
      return { ok: false, status: 400, message: "Invalid message role." };
    }

    if (typeof msg.content === "string") {
      textChars += msg.content.length;
      continue;
    }
    if (!Array.isArray(msg.content) || msg.content.length === 0) {
      return {
        ok: false,
        status: 400,
        message: "Message content must be a string or non-empty parts array.",
      };
    }

    for (const part of msg.content) {
      if (!part || typeof part !== "object") {
        return { ok: false, status: 400, message: "Invalid content part." };
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
            status: 400,
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
            status: 400,
            message:
              "Images must be data:image/png|jpeg|webp;base64,... URLs only.",
          };
        }
        if (url.length > MAX_IMAGE_CHARS) {
          return {
            ok: false,
            status: 413,
            message: "Image payload exceeds size limit.",
          };
        }
        imageCount += 1;
        continue;
      }
      return {
        ok: false,
        status: 400,
        message: "Unsupported content part type.",
      };
    }
  }

  if (textChars > MAX_TEXT_CHARS) {
    return {
      ok: false,
      status: 400,
      message: `Message text exceeds ${MAX_TEXT_CHARS} characters.`,
    };
  }
  if (imageCount > MAX_IMAGES) {
    return {
      ok: false,
      status: 400,
      message: `At most ${MAX_IMAGES} images are allowed.`,
    };
  }

  return {
    ok: true,
    value: {
      model,
      temperature,
      maxTokens,
      messages: b.messages,
      textChars,
      imageCount,
    },
  };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const started = Date.now();

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { ...corsHeaders, "x-request-id": requestId },
    });
  }

  if (req.method !== "POST") {
    return json(
      { message: "Method not allowed.", requestId },
      405,
      requestId,
    );
  }

  let quotaKind: "chat" | "vision" | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;
  let quotaAcquired = false;
  /** When true, inflight is released by the SSE pipe finally — not here. */
  let streamOwnsQuota = false;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json(
        {
          message: "Missing or invalid Authorization bearer token.",
          requestId,
        },
        401,
        requestId,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const groqKey = Deno.env.get("GROQ_API_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error(`[chat-proxy] ${requestId} missing Supabase env`);
      return json(
        { message: "Server misconfigured.", requestId },
        500,
        requestId,
      );
    }
    if (!groqKey) {
      console.error(`[chat-proxy] ${requestId} GROQ_API_KEY not set`);
      return json(
        { message: "Chat AI is not configured on the server.", requestId },
        503,
        requestId,
      );
    }

    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await logProxyEvent(supabase, {
        requestId,
        kind: "auth",
        event: "auth_fail",
        httpStatus: 401,
      });
      return json(
        { message: "Unauthorized. Sign in again and retry.", requestId },
        401,
        requestId,
      );
    }

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return json(
        { message: "Invalid JSON body.", requestId },
        400,
        requestId,
      );
    }

    const validated = validateBody(parsed);
    if (!validated.ok) {
      return json(
        { message: validated.message, requestId },
        validated.status,
        requestId,
      );
    }

    const estimate = estimateChatUnits({
      textChars: validated.value.textChars,
      imageCount: validated.value.imageCount,
    });
    quotaKind = estimate.kind;

    const quota = await beginAiRequest(
      supabase,
      estimate.kind,
      estimate.units,
      requestId,
    );

    if (!quota.allowed) {
      const status = quota.failClosed ? 503 : 429;
      const headers: Record<string, string> = {};
      if (quota.retryAfterSeconds) {
        headers["Retry-After"] = String(quota.retryAfterSeconds);
      }
      if (quota.failClosed) {
        await logProxyEvent(supabase, {
          requestId,
          kind: estimate.kind,
          event: "db_fail",
          httpStatus: 503,
          latencyMs: Date.now() - started,
        });
      }
      return json(
        {
          message: quotaDenialMessage(quota.reason),
          requestId,
          reason: quota.reason,
        },
        status,
        requestId,
        headers,
      );
    }

    quotaAcquired = true;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let upstream: Response;
    try {
      upstream = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: validated.value.model,
          messages: validated.value.messages,
          temperature: validated.value.temperature,
          max_tokens: validated.value.maxTokens,
          stream: true,
          // gpt-oss defaults to putting tokens in `reasoning`; the desktop
          // client reads `delta.content`. Force final answer into content.
          ...(validated.value.model.startsWith("openai/gpt-oss")
            ? { include_reasoning: false }
            : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === "AbortError";
      console.error(
        `[chat-proxy] ${requestId} upstream ${aborted ? "timeout" : "network"} user=${user.id}`,
      );
      await logProxyEvent(supabase, {
        requestId,
        kind: estimate.kind,
        event: aborted ? "provider_timeout" : "provider_error",
        httpStatus: aborted ? 504 : 502,
        latencyMs: Date.now() - started,
      });
      return json(
        {
          message: aborted
            ? "Chat request timed out. Try a shorter prompt."
            : "Chat provider unavailable.",
          requestId,
        },
        aborted ? 504 : 502,
        requestId,
      );
    }

    if (!upstream.ok) {
      clearTimeout(timer);
      console.error(
        `[chat-proxy] ${requestId} groq_status=${upstream.status} user=${user.id}`,
      );
      const status =
        upstream.status === 429
          ? 429
          : upstream.status >= 500
            ? 502
            : 400;
      try {
        await upstream.arrayBuffer();
      } catch {
        /* ignore */
      }
      await logProxyEvent(supabase, {
        requestId,
        kind: estimate.kind,
        event: "provider_error",
        httpStatus: status,
        latencyMs: Date.now() - started,
      });
      return json(
        {
          message:
            upstream.status === 429
              ? "Chat rate limited upstream. Try again shortly."
              : "Chat request failed.",
          requestId,
        },
        status,
        requestId,
      );
    }

    if (!upstream.body) {
      clearTimeout(timer);
      await logProxyEvent(supabase, {
        requestId,
        kind: estimate.kind,
        event: "provider_error",
        httpStatus: 502,
        latencyMs: Date.now() - started,
      });
      return json(
        { message: "Unexpected empty upstream stream.", requestId },
        502,
        requestId,
      );
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = upstream.body.getReader();
    const sb = supabase;
    const kind = estimate.kind;
    streamOwnsQuota = true;

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        await writer.close();
        await logProxyEvent(sb, {
          requestId,
          kind,
          event: "ok",
          httpStatus: 200,
          latencyMs: Date.now() - started,
        });
      } catch {
        try {
          await writer.abort();
        } catch {
          /* ignore */
        }
        await logProxyEvent(sb, {
          requestId,
          kind,
          event: "cancelled",
          httpStatus: 499,
          latencyMs: Date.now() - started,
        });
      } finally {
        clearTimeout(timer);
        await endAiRequest(sb, kind);
      }
    })();

    // Quota consumed at begin (attempt-based). Provider failures still count.
    console.log(
      `[chat-proxy] ${requestId} stream user=${user.id} kind=${kind} model=${validated.value.model} msgs=${validated.value.messages.length} images=${validated.value.imageCount} textChars=${validated.value.textChars}`,
    );

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    console.error(`[chat-proxy] ${requestId} unhandled`, err);
    return json(
      { message: "Unexpected server error.", requestId },
      500,
      requestId,
    );
  } finally {
    if (supabase && quotaAcquired && quotaKind && !streamOwnsQuota) {
      await endAiRequest(supabase, quotaKind);
    }
  }
});
