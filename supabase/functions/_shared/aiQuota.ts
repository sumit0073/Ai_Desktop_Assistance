/**
 * Shared durable quota helpers for chat-proxy / stt-proxy.
 * Policy constants mirrored in src/lib/aiQuotaPolicy.ts and the SQL migration.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type AiRequestKind = "chat" | "vision" | "stt";

export type QuotaBeginResult = {
  allowed: boolean;
  reason: string | null;
  retryAfterSeconds: number | null;
  failClosed: boolean;
  inflight?: number;
  units?: number;
};

export function estimateChatUnits(input: {
  textChars: number;
  imageCount: number;
}): { kind: AiRequestKind; units: number } {
  if (input.imageCount > 0) {
    return { kind: "vision", units: Math.max(5, 5 + input.imageCount * 3) };
  }
  return {
    kind: "chat",
    units: Math.max(1, Math.ceil(Math.max(input.textChars, 1) / 4000)),
  };
}

export function estimateSttUnits(byteLength: number): number {
  return Math.max(1, Math.ceil(Math.max(byteLength, 1) / 200_000));
}

function parseBegin(raw: unknown): QuotaBeginResult {
  if (!raw || typeof raw !== "object") {
    return {
      allowed: false,
      reason: "invalid_rpc_payload",
      retryAfterSeconds: 30,
      failClosed: true,
    };
  }
  const o = raw as Record<string, unknown>;
  const allowed = o.allowed === true;
  return {
    allowed,
    reason: typeof o.reason === "string" ? o.reason : null,
    retryAfterSeconds:
      typeof o.retry_after_seconds === "number" &&
      Number.isFinite(o.retry_after_seconds)
        ? Math.max(1, Math.floor(o.retry_after_seconds))
        : allowed
          ? null
          : 30,
    failClosed: false,
    inflight: typeof o.inflight === "number" ? o.inflight : undefined,
    units: typeof o.units === "number" ? o.units : undefined,
  };
}

export async function beginAiRequest(
  supabase: SupabaseClient,
  kind: AiRequestKind,
  units: number,
  requestId: string,
): Promise<QuotaBeginResult> {
  const { data, error } = await supabase.rpc("ai_begin_ai_request", {
    p_kind: kind,
    p_units: Math.max(1, units),
    p_request_id: requestId,
  });

  if (error) {
    console.error(
      `[aiQuota] begin db_fail kind=${kind} requestId=${requestId} code=${error.code ?? "?"}`,
    );
    return {
      allowed: false,
      reason: "db_fail",
      retryAfterSeconds: 30,
      failClosed: true,
    };
  }

  return parseBegin(data);
}

export async function endAiRequest(
  supabase: SupabaseClient,
  kind: AiRequestKind,
): Promise<void> {
  try {
    await supabase.rpc("ai_end_ai_request", { p_kind: kind });
  } catch {
    console.error(`[aiQuota] end failed kind=${kind}`);
  }
}

export async function logProxyEvent(
  supabase: SupabaseClient,
  input: {
    requestId: string;
    kind: AiRequestKind | "auth" | "system";
    event:
      | "allowed"
      | "rate_limited"
      | "budget_exhausted"
      | "inflight_limited"
      | "auth_fail"
      | "db_fail"
      | "provider_error"
      | "provider_timeout"
      | "ok"
      | "cancelled";
    httpStatus?: number;
    latencyMs?: number;
  },
): Promise<void> {
  try {
    await supabase.rpc("ai_log_proxy_event", {
      p_request_id: input.requestId,
      p_kind: input.kind,
      p_event: input.event,
      p_http_status: input.httpStatus ?? null,
      p_latency_ms: input.latencyMs ?? null,
    });
  } catch {
    // Never fail the user request solely because metrics logging failed.
  }
}

export function quotaDenialMessage(reason: string | null): string {
  switch (reason) {
    case "budget_exhausted":
      return "Daily AI usage budget reached. Try again tomorrow.";
    case "inflight_limited":
      return "Too many AI requests in progress. Wait for one to finish.";
    case "db_fail":
      return "AI quota service unavailable. Try again shortly.";
    case "unauthorized":
      return "Unauthorized. Sign in again and retry.";
    default:
      return "Too many AI requests. Try again shortly.";
  }
}
