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

  it("sanitizes hallucination responses from the proxy", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Thank you." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await transcribeAudioBlob(
      new Blob([new Uint8Array([1])], { type: "audio/wav" }),
    );
    expect(result.originalText).toBe("Thank you.");
    expect(result.text).toBe("");
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
