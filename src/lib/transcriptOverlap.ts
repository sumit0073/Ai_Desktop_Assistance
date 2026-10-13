export type AudioLane = "microphone" | "meeting";

export type OverlapSegmentMeta = {
  text: string;
  /** Preserve pre-dedup text for auditing when caller stores it. */
  originalText?: string;
  source: AudioLane;
  sessionId: string;
  startedAtMs?: number;
  endedAtMs?: number;
};

export type OverlapResult = {
  /** Text to show after safe trim (may equal next.text). */
  text: string;
  /** True when we intentionally dropped a repeated prefix / duplicate. */
  trimmed: boolean;
  reason:
    | "applied"
    | "cross_source"
    | "cross_session"
    | "no_timing_evidence"
    | "insufficient_overlap"
    | "empty"
    | "same_segment";
};

const MIN_OVERLAP_WORDS = 4;
const MAX_OVERLAP_WORDS = 12;
/** Require at least this many ms of temporal adjacency when timestamps exist. */
const MAX_GAP_MS_FOR_OVERLAP = 1_500;
/** When timestamps exist, segments must overlap or nearly abut. */
const MAX_START_DELTA_MS = 2_500;

function timingSuggestsOverlap(
  prev: OverlapSegmentMeta,
  next: OverlapSegmentMeta,
): boolean | "unknown" {
  const hasPrev =
    typeof prev.startedAtMs === "number" && typeof prev.endedAtMs === "number";
  const hasNext =
    typeof next.startedAtMs === "number" && typeof next.endedAtMs === "number";
  if (!hasPrev || !hasNext) return "unknown";

  const prevEnd = prev.endedAtMs!;
  const nextStart = next.startedAtMs!;
  const nextEnd = next.endedAtMs!;
  const prevStart = prev.startedAtMs!;

  // Identical timing window → likely duplicate emit.
  if (prevStart === nextStart && prevEnd === nextEnd) return true;

  // Next starts before prev ends (overlap) or shortly after (splice).
  if (nextStart <= prevEnd + MAX_GAP_MS_FOR_OVERLAP) return true;

  // Far apart in time — do not trim even if text matches.
  if (nextStart - prevEnd > MAX_START_DELTA_MS) return false;

  return false;
}

/**
 * Source- and session-aware overlap trim.
 * Never merges mic ↔ meeting. Never trims across sessions.
 * Without timing evidence, only exact duplicate full segments are dropped.
 */
export function reconcileSegmentOverlap(
  prev: OverlapSegmentMeta | null | undefined,
  next: OverlapSegmentMeta,
): OverlapResult {
  const b = next.text.trim();
  if (!b) {
    return { text: "", trimmed: false, reason: "empty" };
  }
  if (!prev) {
    return { text: b, trimmed: false, reason: "insufficient_overlap" };
  }

  if (prev.source !== next.source) {
    return { text: b, trimmed: false, reason: "cross_source" };
  }
  if (!prev.sessionId || !next.sessionId || prev.sessionId !== next.sessionId) {
    return { text: b, trimmed: false, reason: "cross_session" };
  }

  const a = prev.text.trim();
  if (!a) {
    return { text: b, trimmed: false, reason: "insufficient_overlap" };
  }

  const aNorm = a.toLowerCase();
  const bNorm = b.toLowerCase();
  if (aNorm === bNorm) {
    return { text: "", trimmed: true, reason: "same_segment" };
  }

  const timing = timingSuggestsOverlap(prev, next);

  // Without timestamps: refuse aggressive word-prefix trimming (can delete
  // genuine repetition). Exact duplicates already handled above.
  if (timing === "unknown") {
    return { text: b, trimmed: false, reason: "no_timing_evidence" };
  }
  if (timing === false) {
    return { text: b, trimmed: false, reason: "no_timing_evidence" };
  }

  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);
  const maxCheck = Math.min(
    aWords.length,
    bWords.length,
    MAX_OVERLAP_WORDS,
  );

  for (let n = maxCheck; n >= MIN_OVERLAP_WORDS; n--) {
    const suffix = aWords.slice(-n).join(" ").toLowerCase();
    const prefix = bWords.slice(0, n).join(" ").toLowerCase();
    if (suffix === prefix) {
      const rest = bWords.slice(n).join(" ").trim();
      return {
        text: rest,
        trimmed: true,
        reason: "applied",
      };
    }
  }

  return { text: b, trimmed: false, reason: "insufficient_overlap" };
}

/**
 * @deprecated Prefer reconcileSegmentOverlap with source/session/timing.
 * Kept as a thin exact-duplicate helper for simple callers.
 */
export function stripSegmentOverlap(prev: string, next: string): string {
  const a = prev.trim();
  const b = next.trim();
  if (!a || !b) return b;
  if (a.toLowerCase() === b.toLowerCase()) return "";
  return b;
}
