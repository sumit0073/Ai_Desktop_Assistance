/**
 * Authenticated speech-to-text proxy.
 * - Verifies Supabase user JWT (Authorization: Bearer <access_token>)
 * - Durable Postgres rate limits + daily budgets via ai_begin_ai_request
 * - Forwards audio to Groq Whisper using server-side GROQ_API_KEY only
 * - Never logs raw audio or returns secret-bearing upstream headers
 *
 * Limits mirrored in src/lib/sttProxyValidation.ts — keep in sync.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  beginAiRequest,
  endAiRequest,
  estimateSttUnits,
  logProxyEvent,
  quotaDenialMessage,
} from "../_shared/aiQuota.ts";

const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_PROMPT_CHARS = 900;
const ALLOWED_MODELS = new Set([
  "whisper-large-v3",
  "whisper-large-v3-turbo",
]);
const ALLOWED_MIME = new Set([
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
]);
const UPSTREAM_TIMEOUT_MS = 45_000;

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

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  let supabase: ReturnType<typeof createClient> | null = null;
  let quotaAcquired = false;

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
      console.error(`[stt-proxy] ${requestId} missing Supabase env`);
      return json(
        { message: "Server misconfigured.", requestId },
        500,
        requestId,
      );
    }
    if (!groqKey) {
      console.error(`[stt-proxy] ${requestId} GROQ_API_KEY not set`);
      return json(
        {
          message: "Speech-to-text is not configured on the server.",
          requestId,
        },
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

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json(
        { message: "Audio file is required.", requestId },
        400,
        requestId,
      );
    }

    const byteLength = file.size;
    const mime = (file.type || "application/octet-stream")
      .toLowerCase()
      .split(";")[0]!
      .trim();
    const prompt = String(form.get("prompt") ?? "");
    const model = String(form.get("model") ?? "whisper-large-v3").trim();
    const language = String(form.get("language") ?? "en").trim() || "en";

    if (byteLength <= 0) {
      return json(
        { message: "Audio file is required.", requestId },
        400,
        requestId,
      );
    }
    if (byteLength > MAX_BYTES) {
      return json(
        {
          message: `Audio exceeds maximum size of ${MAX_BYTES} bytes.`,
          requestId,
        },
        413,
        requestId,
      );
    }
    if (mime && !ALLOWED_MIME.has(mime)) {
      return json(
        { message: `Unsupported audio type: ${mime}`, requestId },
        415,
        requestId,
      );
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json(
        {
          message: `Prompt exceeds ${MAX_PROMPT_CHARS} characters.`,
          requestId,
        },
        400,
        requestId,
      );
    }
    if (!ALLOWED_MODELS.has(model)) {
      return json(
        { message: "Unsupported transcription model.", requestId },
        400,
        requestId,
      );
    }

    const units = estimateSttUnits(byteLength);
    const quota = await beginAiRequest(supabase, "stt", units, requestId);

    if (!quota.allowed) {
      const status = quota.failClosed ? 503 : 429;
      const headers: Record<string, string> = {};
      if (quota.retryAfterSeconds) {
        headers["Retry-After"] = String(quota.retryAfterSeconds);
      }
      if (quota.failClosed) {
        await logProxyEvent(supabase, {
          requestId,
          kind: "stt",
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

    const upstreamForm = new FormData();
    upstreamForm.append("file", file, file.name || "capture.wav");
    upstreamForm.append("model", model);
    upstreamForm.append("response_format", "json");
    upstreamForm.append("temperature", "0");
    upstreamForm.append("language", language);
    if (prompt) upstreamForm.append("prompt", prompt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let upstream: Response;
    try {
      upstream = await fetch(GROQ_TRANSCRIBE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${groqKey}` },
        body: upstreamForm,
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      console.error(
        `[stt-proxy] ${requestId} upstream ${aborted ? "timeout" : "network"} user=${user.id}`,
      );
      await logProxyEvent(supabase, {
        requestId,
        kind: "stt",
        event: aborted ? "provider_timeout" : "provider_error",
        httpStatus: aborted ? 504 : 502,
        latencyMs: Date.now() - started,
      });
      return json(
        {
          message: aborted
            ? "Transcription timed out. Try a shorter clip."
            : "Transcription provider unavailable.",
          requestId,
        },
        aborted ? 504 : 502,
        requestId,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      console.error(
        `[stt-proxy] ${requestId} groq_status=${upstream.status} user=${user.id}`,
      );
      const status =
        upstream.status === 429
          ? 429
          : upstream.status >= 500
            ? 502
            : 400;
      await logProxyEvent(supabase, {
        requestId,
        kind: "stt",
        event: "provider_error",
        httpStatus: status,
        latencyMs: Date.now() - started,
      });
      return json(
        {
          message:
            upstream.status === 429
              ? "Transcription rate limited upstream. Try again shortly."
              : "Transcription failed.",
          requestId,
        },
        status,
        requestId,
      );
    }

    let text = "";
    try {
      const data = (await upstream.json()) as { text?: unknown };
      text = typeof data.text === "string" ? data.text.trim() : "";
    } catch {
      console.error(`[stt-proxy] ${requestId} malformed upstream json`);
      await logProxyEvent(supabase, {
        requestId,
        kind: "stt",
        event: "provider_error",
        httpStatus: 502,
        latencyMs: Date.now() - started,
      });
      return json(
        { message: "Unexpected transcription response.", requestId },
        502,
        requestId,
      );
    }

    // Success — no transcript content in logs.
    // Quota was consumed at begin (attempt-based) so retries still cost budget.
    console.log(
      `[stt-proxy] ${requestId} ok user=${user.id} bytes=${byteLength} units=${units}`,
    );
    await logProxyEvent(supabase, {
      requestId,
      kind: "stt",
      event: "ok",
      httpStatus: 200,
      latencyMs: Date.now() - started,
    });

    return json({ text, requestId }, 200, requestId);
  } catch (err) {
    console.error(`[stt-proxy] ${requestId} unhandled`, err);
    return json(
      { message: "Unexpected server error.", requestId },
      500,
      requestId,
    );
  } finally {
    if (supabase && quotaAcquired) {
      await endAiRequest(supabase, "stt");
    }
  }
});
