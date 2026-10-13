/**
 * AI quota / rate-limit policy — keep in sync with
 * supabase/migrations/20261013140000_ai_quota_rate_limits.sql
 * and supabase/functions/_shared/aiQuota.ts
 *
 * These are estimated units for abuse/cost control, not exact Groq billing.
 */

export const AI_QUOTA_LIMITS = {
  /** Shared across chat-proxy + stt-proxy per user per UTC minute. */
  aggPerMinute: 40,
  chatPerMinute: 30,
  visionPerMinute: 10,
  sttPerMinute: 30,
  /** Estimated units per UTC day (not exact USD). */
  chatDailyUnits: 500,
  visionDailyUnits: 80,
  sttDailyUnits: 400,
  chatInflight: 3,
  visionInflight: 2,
  sttInflight: 2,
} as const;

export type AiRequestKind = "chat" | "vision" | "stt";

export type AiQuotaDecision = {
  allowed: boolean;
  reason: string | null;
  retryAfterSeconds: number | null;
  /** Fail closed when the quota service itself is unavailable. */
  failClosed?: boolean;
};

export type AiBeginQuotaResult = AiQuotaDecision & {
  inflight?: number;
  units?: number;
};

/** Estimate daily budget units for a chat/vision call. */
export function estimateChatUnits(input: {
  textChars: number;
  imageCount: number;
}): { kind: AiRequestKind; units: number } {
  if (input.imageCount > 0) {
    return {
      kind: "vision",
      units: Math.max(5, 5 + input.imageCount * 3),
    };
  }
  // ~1 unit per ~4k chars of prompt/history, minimum 1
  return {
    kind: "chat",
    units: Math.max(1, Math.ceil(Math.max(input.textChars, 1) / 4000)),
  };
}

/** Estimate daily budget units for an STT upload. */
export function estimateSttUnits(byteLength: number): number {
  // ~1 unit per ~200 KiB, minimum 1
  return Math.max(1, Math.ceil(Math.max(byteLength, 1) / 200_000));
}

/**
 * Pure fixed-window counter used in unit tests to document concurrency semantics.
 * Mirrors SQL: increment only when count + units <= limit (atomic under row lock).
 */
export function tryBumpFixedWindow(input: {
  count: number;
  limit: number;
  units: number;
}): { ok: true; next: number } | { ok: false; next: number } {
  const units = Math.max(1, input.units);
  if (input.count + units > input.limit) {
    return { ok: false, next: input.count };
  }
  return { ok: true, next: input.count + units };
}

/**
 * Simulate concurrent bumps against one bucket (serializable order).
 * Returns how many succeeded — proves last-writer cannot exceed limit.
 */
export function simulateConcurrentBumps(input: {
  limit: number;
  unitsPerRequest: number;
  concurrentRequests: number;
  initialCount?: number;
}): { succeeded: number; finalCount: number } {
  let count = input.initialCount ?? 0;
  let succeeded = 0;
  for (let i = 0; i < input.concurrentRequests; i++) {
    const result = tryBumpFixedWindow({
      count,
      limit: input.limit,
      units: input.unitsPerRequest,
    });
    if (result.ok) {
      count = result.next;
      succeeded += 1;
    }
  }
  return { succeeded, finalCount: count };
}

export function parseQuotaRpcPayload(raw: unknown): AiBeginQuotaResult {
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
    inflight: typeof o.inflight === "number" ? o.inflight : undefined,
    units: typeof o.units === "number" ? o.units : undefined,
  };
}

/** Map quota denial reason to a safe client message. */
export function quotaDenialMessage(reason: string | null): string {
  switch (reason) {
    case "budget_exhausted":
      return "Daily AI usage budget reached. Try again tomorrow.";
    case "inflight_limited":
      return "Too many AI requests in progress. Wait for one to finish.";
    case "unauthorized":
      return "Unauthorized. Sign in again and retry.";
    case "aggregate_rate_limited":
    case "kind_rate_limited":
    case "rate_limited":
      return "Too many AI requests. Try again shortly.";
    default:
      return "AI request limit reached. Try again shortly.";
  }
}
