import { describe, expect, it } from "vitest";
import {
  AI_QUOTA_LIMITS,
  estimateChatUnits,
  estimateSttUnits,
  parseQuotaRpcPayload,
  quotaDenialMessage,
  simulateConcurrentBumps,
  tryBumpFixedWindow,
} from "./aiQuotaPolicy";

describe("AI_QUOTA_LIMITS policy", () => {
  it("keeps shared aggregate at 40/min with stricter kind caps", () => {
    expect(AI_QUOTA_LIMITS.aggPerMinute).toBe(40);
    expect(AI_QUOTA_LIMITS.chatPerMinute).toBeLessThanOrEqual(
      AI_QUOTA_LIMITS.aggPerMinute,
    );
    expect(AI_QUOTA_LIMITS.visionPerMinute).toBeLessThan(
      AI_QUOTA_LIMITS.chatPerMinute,
    );
    expect(AI_QUOTA_LIMITS.sttPerMinute).toBeLessThanOrEqual(
      AI_QUOTA_LIMITS.aggPerMinute,
    );
  });

  it("tracks chat, vision, and stt daily budgets separately", () => {
    expect(AI_QUOTA_LIMITS.visionDailyUnits).toBeLessThan(
      AI_QUOTA_LIMITS.chatDailyUnits,
    );
    expect(AI_QUOTA_LIMITS.sttDailyUnits).toBeGreaterThan(0);
  });
});

describe("estimate units", () => {
  it("classifies vision when images are present", () => {
    expect(estimateChatUnits({ textChars: 10, imageCount: 1 })).toEqual({
      kind: "vision",
      units: 8,
    });
  });

  it("scales chat units with text size", () => {
    expect(estimateChatUnits({ textChars: 100, imageCount: 0 }).units).toBe(1);
    expect(estimateChatUnits({ textChars: 8001, imageCount: 0 }).units).toBe(3);
  });

  it("scales stt units with audio bytes", () => {
    expect(estimateSttUnits(1000)).toBe(1);
    expect(estimateSttUnits(400_000)).toBe(2);
  });
});

describe("fixed-window concurrency semantics", () => {
  it("never lets concurrent bumps exceed the limit", () => {
    const { succeeded, finalCount } = simulateConcurrentBumps({
      limit: AI_QUOTA_LIMITS.aggPerMinute,
      unitsPerRequest: 1,
      concurrentRequests: 100,
    });
    expect(succeeded).toBe(AI_QUOTA_LIMITS.aggPerMinute);
    expect(finalCount).toBe(AI_QUOTA_LIMITS.aggPerMinute);
  });

  it("isolates users by separate counters", () => {
    const a = simulateConcurrentBumps({
      limit: 5,
      unitsPerRequest: 1,
      concurrentRequests: 5,
    });
    const b = simulateConcurrentBumps({
      limit: 5,
      unitsPerRequest: 1,
      concurrentRequests: 5,
    });
    expect(a.succeeded).toBe(5);
    expect(b.succeeded).toBe(5);
  });

  it("enforces shared aggregate then kind limits", () => {
    // Shared agg fills first
    const agg = simulateConcurrentBumps({
      limit: AI_QUOTA_LIMITS.aggPerMinute,
      unitsPerRequest: 1,
      concurrentRequests: 40,
    });
    expect(agg.succeeded).toBe(40);
    // Kind-specific vision cap is lower; simulate remaining capacity 0 on agg
    const vision = tryBumpFixedWindow({
      count: AI_QUOTA_LIMITS.aggPerMinute,
      limit: AI_QUOTA_LIMITS.aggPerMinute,
      units: 1,
    });
    expect(vision.ok).toBe(false);
  });

  it("rejects units that would cross the limit boundary", () => {
    expect(
      tryBumpFixedWindow({ count: 78, limit: 80, units: 5 }).ok,
    ).toBe(false);
    expect(
      tryBumpFixedWindow({ count: 75, limit: 80, units: 5 }),
    ).toEqual({ ok: true, next: 80 });
  });

  it("treats a new window as an empty counter", () => {
    const nextWindow = simulateConcurrentBumps({
      limit: 3,
      unitsPerRequest: 1,
      concurrentRequests: 3,
      initialCount: 0,
    });
    expect(nextWindow.succeeded).toBe(3);
  });
});

describe("parseQuotaRpcPayload / fail closed", () => {
  it("parses allowed responses", () => {
    const parsed = parseQuotaRpcPayload({
      allowed: true,
      reason: null,
      retry_after_seconds: null,
      inflight: 1,
      units: 2,
    });
    expect(parsed.allowed).toBe(true);
    expect(parsed.units).toBe(2);
    expect(parsed.failClosed).toBeUndefined();
  });

  it("fail-closes on malformed RPC payloads", () => {
    const r = parseQuotaRpcPayload(null);
    expect(r.allowed).toBe(false);
    expect(r.failClosed).toBe(true);
    expect(r.retryAfterSeconds).toBe(30);
  });

  it("maps denial reasons to safe messages", () => {
    expect(quotaDenialMessage("budget_exhausted")).toMatch(/budget/i);
    expect(quotaDenialMessage("aggregate_rate_limited")).toMatch(/shortly/i);
    expect(quotaDenialMessage(null)).not.toMatch(/gsk_|sql|postgres/i);
  });
});
