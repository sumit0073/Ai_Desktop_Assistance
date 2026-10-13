import { afterEach, describe, expect, it } from "vitest";
import {
  buildTextPrivacyStats,
  drainSttDiagnostics,
  drainSttSegmentTraces,
  recordSttDiagnostic,
  recordSttSegmentTrace,
} from "./sttDiagnostics";

describe("sttDiagnostics", () => {
  afterEach(() => {
    drainSttDiagnostics();
    drainSttSegmentTraces();
  });

  it("records privacy-safe outcomes without transcript text fields", () => {
    recordSttDiagnostic({
      outcome: "rejected_hallucination",
      source: "microphone",
      durationMs: 400,
      model: "whisper-large-v3",
      rejectionReason: "weak_evidence_courtesy",
      evidenceTier: "marginal",
    });
    const events = drainSttDiagnostics();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "rejected_hallucination",
      source: "microphone",
      rejectionReason: "weak_evidence_courtesy",
    });
    expect(JSON.stringify(events[0])).not.toMatch(/thank you/i);
  });

  it("distinguishes pre-STT rejection", () => {
    recordSttDiagnostic({
      outcome: "rejected_before_stt",
      source: "meeting",
      audioValidation: "noise_only",
      rejectionReason: "noise_only",
      durationMs: 380,
    });
    expect(drainSttDiagnostics()[0]?.outcome).toBe("rejected_before_stt");
  });

  it("segment trace compares lengths without embedding transcript text", () => {
    const secret = "What is the Fibonacci sequence?";
    const stats = buildTextPrivacyStats(secret, secret);
    recordSttSegmentTrace({
      utteranceId: "utt-1",
      segmentId: "seg-1",
      source: "microphone",
      audio: {
        durationMs: 1380,
        sampleRate: 16_000,
        wavBytes: 44_204,
        mime: "audio/wav",
        peakRms: 0.1816,
        audibleFrames: 42,
        zcr: 0.0484,
        crest: 2.63,
        evidenceTier: "strong",
      },
      request: {
        model: "whisper-large-v3",
        language: "en",
        temperature: 0,
        responseFormat: "json",
        interim: false,
        promptChars: 120,
        hasRecentContext: false,
        proxyConfigured: true,
      },
      response: {
        httpStatus: 200,
        requestId: "req-test",
        ...stats,
        outcome: "accepted",
      },
    });
    const traces = drainSttSegmentTraces();
    expect(traces[0]?.response.rawCharCount).toBe(secret.length);
    expect(traces[0]?.response.displayedInUi).toBe(true);
    expect(JSON.stringify(traces[0])).not.toContain("Fibonacci");
    expect(JSON.stringify(traces[0])).not.toContain(secret);
  });
});
