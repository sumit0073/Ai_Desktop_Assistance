import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { recordSttDiagnostic } from "../lib/sttDiagnostics";
import type { SpeechEvidenceTier } from "../lib/sanitizeTranscript";

export type MeetingAudioSource = "microphone" | "meeting";

export type SourceCaptureStatus =
  | "active"
  | "stopped"
  | { unavailable: { reason: string } }
  | { permissionDenied: { reason: string } };

/** Normalized status from the Rust serde enum. */
export type CaptureLaneStatus =
  | { kind: "active" }
  | { kind: "stopped" }
  | { kind: "unavailable"; reason: string }
  | { kind: "permissionDenied"; reason: string };

export type MeetingCaptureStatus = {
  recording: boolean;
  microphone: unknown;
  meeting: unknown;
};

export type SpeechEvidencePayload = {
  durationMs?: number;
  peakRms?: number;
  audibleFrames?: number;
  clipRatio?: number;
  zeroCrossingRate?: number;
  crestFactor?: number;
  tier?: SpeechEvidenceTier;
};

export type SpeechSegmentEvent = {
  id: string;
  utteranceId?: string;
  source: MeetingAudioSource;
  startedAtMs: number;
  endedAtMs: number;
  sampleRate: number;
  durationMs: number;
  wavBase64: string;
  status: string;
  evidence?: SpeechEvidencePayload;
};

export type SegmentRejectedEvent = {
  source: MeetingAudioSource;
  reason: string;
  durationMs: number;
  isPartial: boolean;
  utteranceId: string;
};

export type AudioPipelineError = {
  source?: MeetingAudioSource;
  message: string;
};

type TranscriptResultLike = {
  originalText: string;
  text: string;
  outcome?: string;
  rejectionReason?: string;
  model?: string;
  requestId?: string;
};

type Options = {
  /** Transcribe a WAV blob; empty `text` skips the UI bubble. */
  transcribe: (
    blob: Blob,
    options?: {
      recentTranscript?: string;
      interim?: boolean;
      signal?: AbortSignal;
      speechEvidence?: SpeechEvidenceTier;
      recentSameSourceTexts?: string[];
      source?: MeetingAudioSource;
      durationMs?: number;
      sampleRate?: number;
      peakRms?: number;
      audibleFrames?: number;
      zcr?: number;
      crest?: number;
      utteranceId?: string;
      segmentId?: string;
      wavBytes?: number;
      mime?: string;
    },
  ) => Promise<string | TranscriptResultLike>;
  /** Same-source rolling context for Whisper prompt. */
  getRecentTranscript?: (source: MeetingAudioSource) => string;
  /** Recent same-source UI texts (for repeated weak-phrase detection). */
  getRecentSameSourceTexts?: (source: MeetingAudioSource) => string[];
  /** Fired when a new capture session successfully starts (reset context). */
  onSessionStart?: (sessionId: string) => void;
  /** Fired when capture stops or the hook unmounts. */
  onSessionEnd?: () => void;
  onTranscript: (
    text: string,
    source: MeetingAudioSource,
    meta: {
      id: string;
      utteranceId: string;
      startedAtMs: number;
      endedAtMs: number;
      originalText: string;
      sessionId: string;
      /** True while the speaker is still talking (growing-window interim). */
      isPartial: boolean;
    },
  ) => void | Promise<void>;
  /**
   * Segment produced no usable transcript (empty STT / hallucination /
   * pre-STT reject). Clear any live partial bubble for this utterance.
   */
  onSegmentDiscarded?: (meta: {
    source: MeetingAudioSource;
    utteranceId: string;
    reason: string;
    isPartial: boolean;
  }) => void;
  onError?: (message: string, source?: MeetingAudioSource) => void;
  onStatus?: (message: string) => void;
};

function parseLaneStatus(raw: unknown): CaptureLaneStatus {
  if (raw === "active") return { kind: "active" };
  if (raw === "stopped") return { kind: "stopped" };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("unavailable" in obj && obj.unavailable && typeof obj.unavailable === "object") {
      const reason =
        (obj.unavailable as { reason?: string }).reason ?? "Unavailable";
      return { kind: "unavailable", reason };
    }
    if (
      "permissionDenied" in obj &&
      obj.permissionDenied &&
      typeof obj.permissionDenied === "object"
    ) {
      const reason =
        (obj.permissionDenied as { reason?: string }).reason ??
        "Permission denied";
      return { kind: "permissionDenied", reason };
    }
    // Externally tagged alternatives from serde
    if (typeof obj.reason === "string") {
      if ("Unavailable" in obj || obj.unavailable !== undefined) {
        return { kind: "unavailable", reason: obj.reason };
      }
    }
  }
  // Internally tagged / adjacent forms from serde rename
  if (typeof raw === "object" && raw !== null) {
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 1) {
      const [key, value] = entries[0]!;
      if (key === "unavailable" && value && typeof value === "object") {
        return {
          kind: "unavailable",
          reason: (value as { reason?: string }).reason ?? "Unavailable",
        };
      }
      if (key === "permissionDenied" && value && typeof value === "object") {
        return {
          kind: "permissionDenied",
          reason:
            (value as { reason?: string }).reason ?? "Permission denied",
        };
      }
    }
  }
  return { kind: "stopped" };
}

function statusLabel(status: CaptureLaneStatus): string {
  switch (status.kind) {
    case "active":
      return "active";
    case "stopped":
      return "stopped";
    case "unavailable":
      return `unavailable (${status.reason})`;
    case "permissionDenied":
      return `permission denied (${status.reason})`;
  }
}

function base64ToWavBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}

/**
 * Native dual-source meeting capture (Tauri/Rust + WebRTC VAD).
 * Only finalized, VAD-validated speech segments are transcribed.
 */
function evidenceTier(
  evidence: SpeechEvidencePayload | undefined,
): SpeechEvidenceTier {
  const t = evidence?.tier;
  if (t === "strong" || t === "marginal") return t;
  return "unknown";
}

export function useMeetingCapture({
  transcribe,
  getRecentTranscript,
  getRecentSameSourceTexts,
  onSessionStart,
  onSessionEnd,
  onTranscript,
  onSegmentDiscarded,
  onError,
  onStatus,
}: Options) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [meetingActive, setMeetingActive] = useState(false);
  const [micMutedHint, setMicMutedHint] = useState(false);

  const onTranscriptRef = useRef(onTranscript);
  const onSegmentDiscardedRef = useRef(onSegmentDiscarded);
  const onErrorRef = useRef(onError);
  const onStatusRef = useRef(onStatus);
  const onSessionStartRef = useRef(onSessionStart);
  const onSessionEndRef = useRef(onSessionEnd);
  const transcribeRef = useRef(transcribe);
  const getRecentRef = useRef(getRecentTranscript);
  const getRecentSameRef = useRef(getRecentSameSourceTexts);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  /** Per-source abort so a newer partial/final supersedes an in-flight STT call. */
  const sourceAbortRef = useRef<
    Partial<Record<MeetingAudioSource, AbortController>>
  >({});
  const inflightCountRef = useRef(0);
  const sessionIdRef = useRef("");
  const sessionEpochRef = useRef(0);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    onSegmentDiscardedRef.current = onSegmentDiscarded;
  }, [onSegmentDiscarded]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);
  useEffect(() => {
    onSessionStartRef.current = onSessionStart;
  }, [onSessionStart]);
  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  }, [onSessionEnd]);
  useEffect(() => {
    transcribeRef.current = transcribe;
  }, [transcribe]);
  useEffect(() => {
    getRecentRef.current = getRecentTranscript;
  }, [getRecentTranscript]);
  useEffect(() => {
    getRecentSameRef.current = getRecentSameSourceTexts;
  }, [getRecentSameSourceTexts]);

  const applyStatus = useCallback((status: MeetingCaptureStatus) => {
    setListening(status.recording);
    const mic = parseLaneStatus(status.microphone);
    const meeting = parseLaneStatus(status.meeting);
    setMicActive(mic.kind === "active");
    setMeetingActive(meeting.kind === "active");
    setMicMutedHint(false);

    const parts: string[] = [];
    if (status.recording) {
      parts.push("Recording…");
      parts.push(`mic ${statusLabel(mic)}`);
      parts.push(`meeting ${statusLabel(meeting)}`);
      parts.push("live speech-to-text");
    }
    if (parts.length) onStatusRef.current?.(parts.join(" · "));
  }, []);

  useEffect(() => {
    let unsubs: UnlistenFn[] = [];
    let cancelled = false;

    const setup = async () => {
      try {
        const u1 = await listen<SpeechSegmentEvent>(
          "seecog://speech-segment",
          (event) => {
            const payload = event.payload;
            if (!payload?.id || !payload.wavBase64) return;
            if (seenIdsRef.current.has(payload.id)) return;
            seenIdsRef.current.add(payload.id);
            if (seenIdsRef.current.size > 200) {
              seenIdsRef.current.clear();
            }

            const isPartial = payload.status === "partial";
            const utteranceId =
              payload.utteranceId?.trim() || payload.id;
            const epochAtStart = sessionEpochRef.current;
            const sessionAtStart = sessionIdRef.current;

            // Supersede any in-flight STT for this lane (newer partial/final wins).
            sourceAbortRef.current[payload.source]?.abort();
            const laneAbort = new AbortController();
            sourceAbortRef.current[payload.source] = laneAbort;
            const onSessionAbort = () => laneAbort.abort();
            abortRef.current?.signal.addEventListener(
              "abort",
              onSessionAbort,
              { once: true },
            );

            inflightCountRef.current += 1;
            setBusy(true);

            void (async () => {
              try {
                if (cancelled) return;
                if (
                  epochAtStart !== sessionEpochRef.current ||
                  !sessionAtStart ||
                  sessionAtStart !== sessionIdRef.current
                ) {
                  return;
                }
                const blob = base64ToWavBlob(payload.wavBase64);
                const recent =
                  getRecentRef.current?.(payload.source) ?? "";
                const recentSame =
                  getRecentSameRef.current?.(payload.source) ?? [];
                const tier = evidenceTier(payload.evidence);
                const ev = payload.evidence;
                const result = await transcribeRef.current(blob, {
                  // Finals only — interim + rolling context biases hallucinations.
                  recentTranscript: isPartial ? undefined : recent,
                  interim: isPartial,
                  signal: laneAbort.signal,
                  speechEvidence: tier,
                  recentSameSourceTexts: recentSame,
                  source: payload.source,
                  durationMs: payload.durationMs,
                  sampleRate: payload.sampleRate,
                  peakRms: ev?.peakRms,
                  audibleFrames: ev?.audibleFrames,
                  zcr: ev?.zeroCrossingRate,
                  crest: ev?.crestFactor,
                  utteranceId,
                  segmentId: payload.id,
                  wavBytes: blob.size,
                  mime: blob.type || "audio/wav",
                });
                if (
                  epochAtStart !== sessionEpochRef.current ||
                  sessionAtStart !== sessionIdRef.current ||
                  laneAbort.signal.aborted
                ) {
                  return;
                }
                const originalText =
                  typeof result === "string"
                    ? result.trim()
                    : (result.originalText ?? "").trim();
                const text =
                  typeof result === "string"
                    ? result.trim()
                    : (result.text ?? "").trim();
                if (text) {
                  await onTranscriptRef.current(text, payload.source, {
                    id: payload.id,
                    utteranceId,
                    startedAtMs: payload.startedAtMs,
                    endedAtMs: payload.endedAtMs,
                    originalText: originalText || text,
                    sessionId: sessionAtStart,
                    isPartial,
                  });
                } else {
                  const reason =
                    typeof result === "string"
                      ? "stt_empty"
                      : (result.rejectionReason ??
                        (originalText ? "rejected_hallucination" : "stt_empty"));
                  onSegmentDiscardedRef.current?.({
                    source: payload.source,
                    utteranceId,
                    reason,
                    isPartial,
                  });
                }
              } catch (err) {
                if (
                  (err instanceof DOMException && err.name === "AbortError") ||
                  laneAbort.signal.aborted
                ) {
                  return;
                }
                if (epochAtStart !== sessionEpochRef.current) return;
                const message =
                  err instanceof Error && err.message
                    ? err.message
                    : "Transcription failed.";
                // Never fabricate a transcript on error.
                onErrorRef.current?.(message, payload.source);
              } finally {
                abortRef.current?.signal.removeEventListener(
                  "abort",
                  onSessionAbort,
                );
                if (sourceAbortRef.current[payload.source] === laneAbort) {
                  delete sourceAbortRef.current[payload.source];
                }
                inflightCountRef.current = Math.max(
                  0,
                  inflightCountRef.current - 1,
                );
                setBusy(inflightCountRef.current > 0);
                try {
                  await invoke("ack_speech_segment");
                } catch {
                  /* ignore outside Tauri */
                }
              }
            })();
          },
        );
        const u2 = await listen<MeetingCaptureStatus>(
          "seecog://audio-status",
          (event) => {
            applyStatus(event.payload);
          },
        );
        const u3 = await listen<AudioPipelineError>(
          "seecog://audio-error",
          (event) => {
            onErrorRef.current?.(event.payload.message, event.payload.source);
          },
        );
        const u4 = await listen<SegmentRejectedEvent>(
          "seecog://segment-rejected",
          (event) => {
            const p = event.payload;
            if (!p?.reason) return;
            recordSttDiagnostic({
              outcome: "rejected_before_stt",
              source: p.source,
              durationMs: p.durationMs,
              audioValidation: p.reason,
              rejectionReason: p.reason,
              interim: p.isPartial,
            });
            if (p.utteranceId) {
              onSegmentDiscardedRef.current?.({
                source: p.source,
                utteranceId: p.utteranceId,
                reason: p.reason,
                isPartial: p.isPartial,
              });
            }
          },
        );
        if (cancelled) {
          u1();
          u2();
          u3();
          u4();
        } else {
          unsubs = [u1, u2, u3, u4];
        }
      } catch {
        // Browser preview without Tauri.
      }
    };

    void setup();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      sessionEpochRef.current += 1;
      sessionIdRef.current = "";
      onSessionEndRef.current?.();
      unsubs.forEach((u) => u());
      void invoke("stop_meeting_capture").catch(() => {});
    };
  }, [applyStatus]);

  const start = useCallback(async () => {
    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      sessionEpochRef.current += 1;
      const sessionId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `session_${Date.now()}`;
      sessionIdRef.current = sessionId;
      onSessionStartRef.current?.(sessionId);
      onStatusRef.current?.(
        "Starting native capture… microphone + meeting loopback (Windows). Audio is sent to STT only when speech is detected.",
      );
      const status = await invoke<MeetingCaptureStatus>("start_meeting_capture");
      applyStatus(status);
      seenIdsRef.current.clear();
    } catch (err) {
      sessionIdRef.current = "";
      onSessionEndRef.current?.();
      setListening(false);
      const message =
        err instanceof Error && err.message
          ? err.message
          : typeof err === "string"
            ? err
            : "Could not start meeting capture.";
      onErrorRef.current?.(message);
    }
  }, [applyStatus]);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    sessionEpochRef.current += 1;
    sessionIdRef.current = "";
    onSessionEndRef.current?.();
    try {
      await invoke("stop_meeting_capture");
    } catch {
      /* ignore */
    }
    setListening(false);
    setMicActive(false);
    setMeetingActive(false);
    onStatusRef.current?.("Recording stopped.");
  }, []);

  const toggle = useCallback(() => {
    if (listening) void stop();
    else void start();
  }, [listening, start, stop]);

  return {
    listening,
    busy,
    toggle,
    start,
    stop,
    sources: { mic: micActive, meeting: meetingActive },
    micMuted: micMutedHint,
  };
}
