import { describe, expect, it } from "vitest";
import {
  CHAT_PROXY_MAX_IMAGE_CHARS,
  CHAT_PROXY_MAX_MESSAGES,
  CHAT_PROXY_MAX_TEXT_CHARS,
  ChatSlidingWindowRateLimiter,
  shouldAllowDirectGroqChat,
  validateChatProxyRequest,
} from "./chatProxyValidation";

describe("validateChatProxyRequest", () => {
  const base = {
    model: "openai/gpt-oss-20b",
    messages: [{ role: "user", content: "hello" }],
    stream: true as const,
  };

  it("accepts a valid text chat request", () => {
    const result = validateChatProxyRequest(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.textChars).toBe(5);
      expect(result.imageCount).toBe(0);
    }
  });

  it("accepts vision data-URL images within limits", () => {
    const result = validateChatProxyRequest({
      ...base,
      model: "qwen/qwen3.8-27b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is on screen?" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgo=",
              },
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.imageCount).toBe(1);
  });

  it("rejects missing messages", () => {
    const result = validateChatProxyRequest({
      model: "openai/gpt-oss-20b",
      messages: [],
    });
    expect(result).toMatchObject({ ok: false, code: "missing_messages" });
  });

  it("rejects unsupported models", () => {
    const result = validateChatProxyRequest({
      ...base,
      model: "gpt-4o",
    });
    expect(result).toMatchObject({ ok: false, code: "unsupported_model" });
  });

  it("rejects stream:false", () => {
    const result = validateChatProxyRequest({
      ...base,
      stream: false,
    });
    expect(result).toMatchObject({ ok: false, code: "stream_required" });
  });

  it("rejects invalid max_tokens", () => {
    expect(
      validateChatProxyRequest({ ...base, max_tokens: 10 }),
    ).toMatchObject({ ok: false, code: "invalid_max_tokens" });
    expect(
      validateChatProxyRequest({ ...base, max_tokens: 4096 }),
    ).toMatchObject({ ok: true });
  });

  it("rejects too many messages", () => {
    const messages = Array.from({ length: CHAT_PROXY_MAX_MESSAGES + 1 }, () => ({
      role: "user",
      content: "x",
    }));
    const result = validateChatProxyRequest({
      model: "openai/gpt-oss-20b",
      messages,
    });
    expect(result).toMatchObject({ ok: false, code: "too_many_messages" });
  });

  it("rejects oversized text", () => {
    const result = validateChatProxyRequest({
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "user", content: "a".repeat(CHAT_PROXY_MAX_TEXT_CHARS + 1) },
      ],
    });
    expect(result).toMatchObject({ ok: false, code: "text_too_long" });
  });

  it("rejects oversized images", () => {
    const result = validateChatProxyRequest({
      model: "qwen/qwen3.8-27b",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${"A".repeat(CHAT_PROXY_MAX_IMAGE_CHARS)}`,
              },
            },
          ],
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, code: "image_too_large" });
  });

  it("rejects remote image URLs", () => {
    const result = validateChatProxyRequest({
      model: "qwen/qwen3.8-27b",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://evil.example/img.png" },
            },
          ],
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, code: "unsupported_image" });
  });

  it("rejects invalid temperature", () => {
    const result = validateChatProxyRequest({
      ...base,
      temperature: 2,
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_temperature" });
  });
});

describe("ChatSlidingWindowRateLimiter", () => {
  it("rate limits after max hits", () => {
    const limiter = new ChatSlidingWindowRateLimiter(60_000, 2);
    expect(limiter.allow("u1", 1000).ok).toBe(true);
    expect(limiter.allow("u1", 1001).ok).toBe(true);
    expect(limiter.allow("u1", 1002)).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
  });
});

describe("shouldAllowDirectGroqChat", () => {
  it("never allows direct in production without proxy preference", () => {
    expect(
      shouldAllowDirectGroqChat({
        prod: true,
        allowDirectDevFlag: "true",
      }).allow,
    ).toBe(false);
    expect(
      shouldAllowDirectGroqChat({
        prod: true,
        allowDirectDevFlag: "true",
      }).reason,
    ).toBe("production_requires_proxy");
  });

  it("prefers proxy over direct even in dev", () => {
    expect(
      shouldAllowDirectGroqChat({
        prod: false,
        proxyUrl: "https://example/functions/v1/chat-proxy",
        allowDirectDevFlag: "true",
      }),
    ).toEqual({ allow: false, reason: "proxy_configured" });
  });

  it("requires explicit dev opt-in", () => {
    expect(
      shouldAllowDirectGroqChat({
        prod: false,
        allowDirectDevFlag: "",
      }).allow,
    ).toBe(false);
  });
});
