/**
 * Privacy-safe STT latency traces. Never log PCM, tokens, or transcript text.
 * Correlate stages with segmentId / utteranceId / requestId.
 */

export type SttLatencyStageMs = {
  /** Wall time from speech onset (startedAtMs) to Rust emit. */
  speechToEmitMs?: number;
  /** FE receive − Rust emittedAtMs (IPC + queue). */
  emitToFeMs?: number;
  /** Time from FE receive until STT fetch starts (decode + schedule). */
  feScheduleMs?: number;
  /** Full STT round-trip (client fetch start → response body parsed). */
  sttRoundTripMs?: number;
  /** Upstream Groq time from proxy header (when present). */
  proxyUpstreamMs?: number;
  /** Proxy total time from proxy header (when present). */
  proxyTotalMs?: number;
  /** Sanitize + finalize (usually <5ms). */
  sanitizeMs?: number;
  /** onTranscript / UI apply. */
  uiApplyMs?: number;
  /**
   * Speech onset → first UI text for this utterance (partial or final).
   * Only set when text is displayed.
   */
  speechToUiMs?: number;
  /** Speech end → UI for finals (perceived lag after talking stops). */
  speechEndToUiMs?: number;
};

export type SttLatencyTrace = {
  segmentId: string;
  utteranceId: string;
  source: "microphone" | "meeting" | "composer" | "unknown";
  interim: boolean;
  model?: string;
  requestId?: string;
  audioDurationMs?: number;
  stages: SttLatencyStageMs;
  /** Sum of measurable network-ish stages when present. */
  e2eFeMs?: number;
  outcome?: string;
};

const MAX_BUFFER = 60;
const buffer: SttLatencyTrace[] = [];

function finiteOrUndef(n: number | undefined): number | undefined {
  if (n === undefined || !Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

export function recordSttLatencyTrace(trace: SttLatencyTrace): void {
  const stages: SttLatencyStageMs = {};
  for (const [k, v] of Object.entries(trace.stages) as [
    keyof SttLatencyStageMs,
    number | undefined,
  ][]) {
    const cleaned = finiteOrUndef(v);
    if (cleaned !== undefined) stages[k] = cleaned;
  }

  const hasFeStages =
    stages.feScheduleMs !== undefined || stages.sttRoundTripMs !== undefined;
  const e2eFeMs = hasFeStages
    ? finiteOrUndef(
        (stages.feScheduleMs ?? 0) +
          (stages.sttRoundTripMs ?? 0) +
          (stages.sanitizeMs ?? 0) +
          (stages.uiApplyMs ?? 0),
      )
    : undefined;

  const entry: SttLatencyTrace = {
    ...trace,
    stages,
    e2eFeMs,
  };

  buffer.push(entry);
  while (buffer.length > MAX_BUFFER) buffer.shift();

  if (import.meta.env.DEV) {
    console.debug("[stt-latency]", JSON.stringify(entry));
  }
}

/** Test helper. */
export function drainSttLatencyTraces(): SttLatencyTrace[] {
  const out = [...buffer];
  buffer.length = 0;
  return out;
}

/** Test / diagnostics helper. */
export function peekSttLatencyTraces(): readonly SttLatencyTrace[] {
  return buffer;
}

/**
 * Summarize recent traces for console / user paste-back.
 * Privacy-safe: counts and timing only.
 */
export function summarizeSttLatency(
  traces: readonly SttLatencyTrace[] = buffer,
): {
  count: number;
  interimCount: number;
  finalCount: number;
  medianSpeechToUiMs: number | null;
  p95SpeechToUiMs: number | null;
  medianSttRoundTripMs: number | null;
  p95SttRoundTripMs: number | null;
  medianProxyUpstreamMs: number | null;
  medianSpeechEndToUiMs: number | null;
} {
  const speechToUi = traces
    .map((t) => t.stages.speechToUiMs)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  const stt = traces
    .map((t) => t.stages.sttRoundTripMs)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  const upstream = traces
    .map((t) => t.stages.proxyUpstreamMs)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  const endToUi = traces
    .filter((t) => !t.interim)
    .map((t) => t.stages.speechEndToUiMs)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);

  return {
    count: traces.length,
    interimCount: traces.filter((t) => t.interim).length,
    finalCount: traces.filter((t) => !t.interim).length,
    medianSpeechToUiMs: percentile(speechToUi, 0.5),
    p95SpeechToUiMs: percentile(speechToUi, 0.95),
    medianSttRoundTripMs: percentile(stt, 0.5),
    p95SttRoundTripMs: percentile(stt, 0.95),
    medianProxyUpstreamMs: percentile(upstream, 0.5),
    medianSpeechEndToUiMs: percentile(endToUi, 0.5),
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[idx] ?? null;
}

/** DEV console helper: `window.__sttLatency.summary()` */
export function installSttLatencyDevtools(): void {
  if (!import.meta.env.DEV) return;
  const w = window as Window & {
    __sttLatency?: {
      peek: typeof peekSttLatencyTraces;
      drain: typeof drainSttLatencyTraces;
      summary: () => ReturnType<typeof summarizeSttLatency>;
    };
  };
  w.__sttLatency = {
    peek: peekSttLatencyTraces,
    drain: drainSttLatencyTraces,
    summary: () => summarizeSttLatency(peekSttLatencyTraces()),
  };
}

export function parseProxyTimingHeaders(headers: Headers): {
  proxyUpstreamMs?: number;
  proxyTotalMs?: number;
  requestId?: string;
} {
  const upstream = headers.get("x-upstream-ms") ?? headers.get("X-Upstream-Ms");
  const total = headers.get("x-proxy-ms") ?? headers.get("X-Proxy-Ms");
  const requestId =
    headers.get("x-request-id")?.trim() ||
    headers.get("X-Request-Id")?.trim() ||
    undefined;
  const proxyUpstreamMs = upstream ? Number(upstream) : undefined;
  const proxyTotalMs = total ? Number(total) : undefined;
  return {
    proxyUpstreamMs: Number.isFinite(proxyUpstreamMs)
      ? proxyUpstreamMs
      : undefined,
    proxyTotalMs: Number.isFinite(proxyTotalMs) ? proxyTotalMs : undefined,
    requestId,
  };
}
