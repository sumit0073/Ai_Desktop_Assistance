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

// Force groqFetch to use globalThis.fetch in unit tests.
vi.mock("@tauri-apps/plugin-http", () => {
  throw new Error("tauri http unavailable in vitest");
});

import { analyzeWithAi, getChatProxyUrl } from "./ai";
import { shouldAllowDirectGroqChat } from "./chatProxyValidation";

function sseResponse(text: string): Response {
  const payload = `data: ${JSON.stringify({
    choices: [{ delta: { content: text } }],
  })}\n\ndata: [DONE]\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("analyzeWithAi proxy routing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv(
      "VITE_CHAT_PROXY_URL",
      "https://example.supabase.co/functions/v1/chat-proxy",
    );
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("VITE_ALLOW_DIRECT_GROQ_CHAT", "");
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

  it("posts streaming chat to the proxy with Bearer session token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse("Hello from proxy"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const chunks: string[] = [];
    const text = await analyzeWithAi({
      prompt: "Say hi",
      onChunk: (t) => chunks.push(t),
    });

    expect(text).toBe("Hello from proxy");
    expect(chunks.at(-1)).toBe("Hello from proxy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(getChatProxyUrl());
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer user-jwt-token",
      apikey: "test-anon-key",
    });
    const body = JSON.parse(String((init as RequestInit).body)) as {
      stream: boolean;
      model: string;
      messages: unknown[];
      max_tokens?: number;
    };
    expect(body.stream).toBe(true);
    expect(body.model).toBeTruthy();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(String(url)).not.toContain("api.groq.com");
  });

  it("requests a higher max_tokens budget for architecture generation", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        sseResponse(
          "# Architecture: Shop\n\n## Overview\nComplete.\n\n```mermaid\nflowchart TB\nA-->B\n```\n\n## Major Components\n| Component | Responsibility |\n|---|---|\n| API | Entry |\n\n## Database and Storage Strategy\n| Store | Type | What it holds | Why |\n|---|---|---|---|\n| DB | SQL | Orders | Source of truth |\n\n## Key Workflows\n1. Place order.\n\n## Scalability and reliability\nHorizontal scale.\n\n## Assumptions and trade-offs\nSingle region.",
        ),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await analyzeWithAi({
      prompt: "Design an e-commerce order management system",
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    ) as { max_tokens?: number };
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096);
  });

  it("does not force full architecture mode for scalability follow-ups", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        sseResponse(
          "Scale the order service horizontally behind a load balancer and shard the orders DB by customer id.",
        ),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await analyzeWithAi({
      prompt: "What about scalability?",
      history: [
        {
          role: "assistant",
          content:
            "# Architecture: Orders\n```mermaid\nflowchart TB\nA-->B\n```\nDone.",
        },
      ],
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    ) as {
      max_tokens?: number;
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toMatch(/Answer ONLY the user's follow-up aspect/i);
    expect(system).not.toMatch(/Output order \(architecture responses only\)/i);
    expect(body.max_tokens).toBe(2048);
  });

  it("rejects missing auth session for proxy path", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(analyzeWithAi({ prompt: "hi" })).rejects.toThrow(/Sign in/i);
  });

  it("maps proxy auth failures", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: "Unauthorized. Sign in again and retry." }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    await expect(analyzeWithAi({ prompt: "hi" })).rejects.toThrow(
      /Unauthorized|Sign in/i,
    );
  });

  it("does not fall back to direct Groq when proxy is configured", async () => {
    vi.stubEnv("VITE_GROQ_API_KEY", "sk_test_should_not_be_used");
    vi.stubEnv("VITE_ALLOW_DIRECT_GROQ_CHAT", "true");
    const fetchMock = vi.fn().mockResolvedValue(sseResponse("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await analyzeWithAi({ prompt: "hi" });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("chat-proxy");
    expect(url).not.toContain("api.groq.com");
  });

  it("supports AbortSignal cancellation", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) {
          reject(new Error("expected AbortSignal"));
          return;
        }
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const pending = analyzeWithAi({
      prompt: "hi",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("accepts vision payloads through the proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse("I see a button"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await analyzeWithAi({
      prompt: "What is this?",
      imageBase64: "/9j/4AAQ", // jpeg magic → image/jpeg
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    ) as {
      model: string;
      messages: Array<{ content: unknown }>;
    };
    expect(body.model).toContain("qwen");
    const last = body.messages[body.messages.length - 1]!;
    expect(Array.isArray(last.content)).toBe(true);
  });
});

describe("production without chat proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks direct Groq via shouldAllowDirectGroqChat contract", () => {
    expect(
      shouldAllowDirectGroqChat({
        prod: true,
        proxyUrl: undefined,
        allowDirectDevFlag: "true",
      }),
    ).toEqual({ allow: false, reason: "production_requires_proxy" });
  });
});
