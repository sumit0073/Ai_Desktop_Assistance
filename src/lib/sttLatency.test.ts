import { afterEach, describe, expect, it } from "vitest";
import {
  drainSttLatencyTraces,
  parseProxyTimingHeaders,
  recordSttLatencyTrace,
  summarizeSttLatency,
} from "./sttLatency";

describe("sttLatency", () => {
  afterEach(() => {
    drainSttLatencyTraces();
  });

  it("records timing without transcript text", () => {
    recordSttLatencyTrace({
      segmentId: "seg-1",
      utteranceId: "utt-1",
      source: "microphone",
      interim: true,
      model: "whisper-large-v3-turbo",
      stages: {
        speechToEmitMs: 720,
        sttRoundTripMs: 980,
        speechToUiMs: 1750,
      },
    });
    const traces = drainSttLatencyTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]?.stages.sttRoundTripMs).toBe(980);
    expect(JSON.stringify(traces[0])).not.toMatch(/thank you|fibonacci/i);
  });

  it("summarizes median and p95 when samples exist", () => {
    for (const ms of [1000, 2000, 3000, 4000, 5000]) {
      recordSttLatencyTrace({
        segmentId: `s-${ms}`,
        utteranceId: `u-${ms}`,
        source: "meeting",
        interim: false,
        stages: {
          speechToUiMs: ms,
          sttRoundTripMs: ms / 2,
          speechEndToUiMs: ms - 500,
        },
      });
    }
    const summary = summarizeSttLatency();
    expect(summary.count).toBe(5);
    expect(summary.finalCount).toBe(5);
    expect(summary.medianSpeechToUiMs).toBe(3000);
    expect(summary.p95SpeechToUiMs).toBe(5000);
    expect(summary.medianSttRoundTripMs).toBe(1500);
  });

  it("parses proxy timing headers", () => {
    const headers = new Headers({
      "x-upstream-ms": "842",
      "x-proxy-ms": "901",
      "x-request-id": "req-abc",
    });
    expect(parseProxyTimingHeaders(headers)).toEqual({
      proxyUpstreamMs: 842,
      proxyTotalMs: 901,
      requestId: "req-abc",
    });
  });
});
