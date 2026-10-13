import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("./supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => getSession(),
    },
  },
}));

import { getSttProxyUrl, transcribeAudioBlob } from "./transcribeAudio";

describe("transcribeAudioBlob", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("VITE_STT_PROXY_URL", "https://example.supabase.co/functions/v1/stt-proxy");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("VITE_ALLOW_DIRECT_GROQ_STT", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "");
    getSession.mockResolvedValue({
      data: { session: { access_token: "user-jwt-token" } },
      error: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("posts to the proxy with Authorization bearer from Supabase session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "What is binary search?" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await transcribeAudioBlob(
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
    );

    expect(result.originalText).toBe("What is binary search?");
    expect(result.text).toBe("What is binary search?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(getSttProxyUrl());
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer user-jwt-token",
      apikey: "test-anon-key",
    });
  });

  it("rejects missing auth session for proxy path", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(
      transcribeAudioBlob(new Blob([new Uint8Array([1])], { type: "audio/wav" })),
    ).rejects.toThrow(/Sign in/i);
  });

  it("maps proxy auth failures without fabricating transcript text", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized. Sign in again and retry." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      transcribeAudioBlob(new Blob([new Uint8Array([1])], { type: "audio/wav" })),
    ).rejects.toThrow(/Unauthorized/i);
  });

  it("sanitizes weak-evidence courtesy hallucinations from the proxy", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Thank you." }), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-request-id": "req-1" },
      }),
    ) as unknown as typeof fetch;

    const result = await transcribeAudioBlob(
      new Blob([new Uint8Array([1])], { type: "audio/wav" }),
      { speechEvidence: "marginal", source: "microphone", durationMs: 400 },
    );
    expect(result.originalText).toBe("Thank you.");
    expect(result.text).toBe("");
    expect(result.outcome).toBe("rejected_hallucination");
    expect(result.requestId).toBe("req-1");
  });

  it("keeps thank-you when native evidence is strong", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Thank you." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await transcribeAudioBlob(
      new Blob([new Uint8Array([1])], { type: "audio/wav" }),
      { speechEvidence: "strong", source: "meeting", durationMs: 900 },
    );
    expect(result.text).toBe("Thank you.");
    expect(result.outcome).toBe("accepted");
  });

  it("emits a privacy-safe segment trace for one accepted proxy response", async () => {
    const { drainSttSegmentTraces } = await import("./sttDiagnostics");
    drainSttSegmentTraces();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "What is binary search?" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "trace-req-1",
        },
      }),
    ) as unknown as typeof fetch;

    await transcribeAudioBlob(
      new Blob([new Uint8Array(2048)], { type: "audio/wav" }),
      {
        utteranceId: "utt-trace",
        segmentId: "seg-trace",
        source: "microphone",
        durationMs: 1380,
        sampleRate: 16_000,
        peakRms: 0.1816,
        audibleFrames: 42,
        zcr: 0.0484,
        crest: 2.63,
        speechEvidence: "strong",
      },
    );

    const traces = drainSttSegmentTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      utteranceId: "utt-trace",
      audio: { durationMs: 1380, evidenceTier: "strong", peakRms: 0.1816 },
      request: {
        model: "whisper-large-v3",
        language: "en",
        temperature: 0,
        proxyConfigured: true,
        interim: false,
      },
      response: {
        requestId: "trace-req-1",
        outcome: "accepted",
        displayedInUi: true,
        rawCharCount: "What is binary search?".length,
        sanitizedCharCount: "What is binary search?".length,
      },
    });
    expect(JSON.stringify(traces[0])).not.toContain("binary search");
  });

  it("does not pass rolling context on interim partials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "hello" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await transcribeAudioBlob(
      new Blob([new Uint8Array([1])], { type: "audio/wav" }),
      {
        interim: true,
        recentTranscript: "Previous unrelated sentence about Redis",
      },
    );
    const body = fetchMock.mock.calls[0]![1] as RequestInit;
    const form = body.body as FormData;
    const prompt = String(form.get("prompt") ?? "");
    expect(prompt).not.toMatch(/Previous unrelated/);
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
  });

  it("does not fall back to direct Groq when proxy is configured even if a client key exists", async () => {
    vi.stubEnv("VITE_GROQ_API_KEY", "sk_test_should_not_be_used");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await transcribeAudioBlob(
      new Blob([new Uint8Array([1])], { type: "audio/wav" }),
    );
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("stt-proxy");
    expect(url).not.toContain("api.groq.com");
  });
});

describe("production without proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("blocks direct Groq via shouldAllowDirectGroqStt contract", async () => {
    // Import isolation: assert the gate used by production path.
    const { shouldAllowDirectGroqStt } = await import("./sttProxyValidation");
    expect(
      shouldAllowDirectGroqStt({
        prod: true,
        proxyUrl: undefined,
        allowDirectDevFlag: "true",
      }).allow,
    ).toBe(false);
  });
});
