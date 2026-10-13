/**
 * Privacy-safe STT diagnostics. Never log PCM, API keys, or full transcripts.
 */

export type SttOutcomeKind =
  | "rejected_before_stt"
  | "stt_empty"
  | "rejected_hallucination"
  | "accepted";

export type SttDiagnosticEvent = {
  outcome: SttOutcomeKind;
  source: "microphone" | "meeting" | "composer" | "unknown";
  durationMs?: number;
  audioValidation?: string;
  model?: string;
  rejectionReason?: string;
  requestId?: string;
  evidenceTier?: "strong" | "marginal" | "unknown";
  interim?: boolean;
  utteranceId?: string;
  segmentId?: string;
};

/** End-to-end trace for one segment (scalars / flags only). */
export type SttSegmentTrace = {
  utteranceId: string;
  segmentId?: string;
  source: "microphone" | "meeting" | "composer" | "unknown";
  /** 1) Captured audio */
  audio: {
    durationMs: number;
    sampleRate?: number;
    wavBytes: number;
    mime: string;
    peakRms?: number;
    audibleFrames?: number;
    zcr?: number;
    crest?: number;
    evidenceTier: "strong" | "marginal" | "unknown";
  };
  /** 2) STT request */
  request: {
    model: string;
    language: string;
    temperature: 0;
    responseFormat: "json";
    interim: boolean;
    promptChars: number;
    hasRecentContext: boolean;
    proxyConfigured: boolean;
  };
  /** 3) Raw vs sanitized (lengths only — no text) */
  response: {
    httpStatus?: number;
    requestId?: string;
    rawCharCount: number;
    rawWordCount: number;
    sanitizedCharCount: number;
    sanitizedWordCount: number;
    outcome: SttOutcomeKind;
    rejectionReason?: string;
    displayedInUi: boolean;
  };
};

const MAX_BUFFER = 40;
const buffer: SttDiagnosticEvent[] = [];
const traceBuffer: SttSegmentTrace[] = [];

function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/** Structured console debug line (dev) + in-memory ring for tests. */
export function recordSttDiagnostic(event: SttDiagnosticEvent): void {
  buffer.push(event);
  while (buffer.length > MAX_BUFFER) buffer.shift();

  if (import.meta.env.DEV) {
    console.debug("[stt]", {
      outcome: event.outcome,
      source: event.source,
      durationMs: event.durationMs,
      audioValidation: event.audioValidation,
      model: event.model,
      rejectionReason: event.rejectionReason,
      requestId: event.requestId,
      evidenceTier: event.evidenceTier,
      interim: event.interim,
      utteranceId: event.utteranceId,
      segmentId: event.segmentId,
    });
  }
}

/**
 * One-segment comparison: capture metrics → STT params → raw vs UI lengths.
 * Never includes transcript text, WAV bytes, or secrets.
 */
export function recordSttSegmentTrace(trace: SttSegmentTrace): void {
  traceBuffer.push(trace);
  while (traceBuffer.length > MAX_BUFFER) traceBuffer.shift();

  if (import.meta.env.DEV) {
    console.debug("[stt-segment-trace]", JSON.stringify(trace));
  }
}

export function buildTextPrivacyStats(raw: string, sanitized: string): {
  rawCharCount: number;
  rawWordCount: number;
  sanitizedCharCount: number;
  sanitizedWordCount: number;
  displayedInUi: boolean;
} {
  return {
    rawCharCount: raw.trim().length,
    rawWordCount: wordCount(raw),
    sanitizedCharCount: sanitized.trim().length,
    sanitizedWordCount: wordCount(sanitized),
    displayedInUi: sanitized.trim().length > 0,
  };
}

/** Test helper. */
export function drainSttDiagnostics(): SttDiagnosticEvent[] {
  const out = [...buffer];
  buffer.length = 0;
  return out;
}

/** Test helper. */
export function peekSttDiagnostics(): readonly SttDiagnosticEvent[] {
  return buffer;
}

/** Test helper. */
export function drainSttSegmentTraces(): SttSegmentTrace[] {
  const out = [...traceBuffer];
  traceBuffer.length = 0;
  return out;
}

/** Test helper. */
export function peekSttSegmentTraces(): readonly SttSegmentTrace[] {
  return traceBuffer;
}
