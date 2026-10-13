import { describe, expect, it } from "vitest";
import {
  shouldAllowDirectGroqStt,
  SlidingWindowRateLimiter,
  STT_PROXY_MAX_BYTES,
  STT_PROXY_MAX_PROMPT_CHARS,
  validateSttUpload,
} from "./sttProxyValidation";

describe("validateSttUpload", () => {
  it("accepts a normal wav upload", () => {
    expect(
      validateSttUpload({
        byteLength: 2048,
        mimeType: "audio/wav",
        prompt: "Vocabulary hints: Fibonacci sequence.",
        model: "whisper-large-v3-turbo",
      }).ok,
    ).toBe(true);
  });

  it("rejects missing / oversized / bad mime / long prompt / bad model", () => {
    expect(
      validateSttUpload({
        byteLength: 0,
        mimeType: "audio/wav",
        prompt: "",
        model: "whisper-large-v3-turbo",
      }).code,
    ).toBe("missing_file");

    expect(
      validateSttUpload({
        byteLength: STT_PROXY_MAX_BYTES + 1,
        mimeType: "audio/wav",
        prompt: "",
        model: "whisper-large-v3-turbo",
      }).code,
    ).toBe("file_too_large");

    expect(
      validateSttUpload({
        byteLength: 100,
        mimeType: "image/png",
        prompt: "",
        model: "whisper-large-v3-turbo",
      }).code,
    ).toBe("unsupported_mime");

    expect(
      validateSttUpload({
        byteLength: 100,
        mimeType: "audio/wav",
        prompt: "x".repeat(STT_PROXY_MAX_PROMPT_CHARS + 1),
        model: "whisper-large-v3-turbo",
      }).code,
    ).toBe("prompt_too_long");

    expect(
      validateSttUpload({
        byteLength: 100,
        mimeType: "audio/wav",
        prompt: "",
        model: "gpt-4o",
      }).code,
    ).toBe("unsupported_model");
  });
});

describe("SlidingWindowRateLimiter", () => {
  it("rate limits after max hits", () => {
    const limiter = new SlidingWindowRateLimiter(60_000, 3);
    expect(limiter.allow("u1", 1000).ok).toBe(true);
    expect(limiter.allow("u1", 1100).ok).toBe(true);
    expect(limiter.allow("u1", 1200).ok).toBe(true);
    expect(limiter.allow("u1", 1300).code).toBe("rate_limited");
    expect(limiter.allow("u2", 1300).ok).toBe(true);
  });
});

describe("shouldAllowDirectGroqStt", () => {
  it("never allows direct Groq in production", () => {
    expect(
      shouldAllowDirectGroqStt({
        prod: true,
        allowDirectDevFlag: "true",
      }).allow,
    ).toBe(false);
    expect(
      shouldAllowDirectGroqStt({
        prod: true,
        proxyUrl: undefined,
      }).reason,
    ).toBe("production_requires_proxy");
  });

  it("requires explicit dev opt-in when no proxy", () => {
    expect(
      shouldAllowDirectGroqStt({
        prod: false,
        allowDirectDevFlag: undefined,
      }).allow,
    ).toBe(false);
    expect(
      shouldAllowDirectGroqStt({
        prod: false,
        allowDirectDevFlag: "true",
      }).allow,
    ).toBe(true);
  });
});
