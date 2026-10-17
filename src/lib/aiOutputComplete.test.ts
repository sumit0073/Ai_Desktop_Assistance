import { describe, expect, it } from "vitest";
import {
  architectureMaxTokens,
  looksLikeTruncatedOutput,
  shouldContinueArchitectureOutput,
} from "./aiOutputComplete";

describe("looksLikeTruncatedOutput", () => {
  it("detects mid-sentence endings", () => {
    expect(
      looksLikeTruncatedOutput(
        "# Architecture: Orders\n\nAn e-commerce order management system with a",
      ),
    ).toBe(true);
    expect(
      looksLikeTruncatedOutput("Clients talk to the API gateway, which then"),
    ).toBe(true);
  });

  it("detects unclosed mermaid fences", () => {
    expect(
      looksLikeTruncatedOutput("## Diagram\n```mermaid\nflowchart TB\nA-->B"),
    ).toBe(true);
  });

  it("accepts complete short answers", () => {
    expect(
      looksLikeTruncatedOutput(
        "HLD is the high-level design; LLD is the detailed component design.",
      ),
    ).toBe(false);
    expect(looksLikeTruncatedOutput("Yes.")).toBe(false);
  });
});

describe("shouldContinueArchitectureOutput", () => {
  it("continues when finish_reason is length", () => {
    expect(
      shouldContinueArchitectureOutput({
        text: "Partial architecture about the",
        finishReason: "length",
        architectureMode: true,
      }),
    ).toBe(true);
  });

  it("does not continue normal short answers", () => {
    expect(
      shouldContinueArchitectureOutput({
        text: "HLD means high-level design.",
        finishReason: "stop",
        architectureMode: false,
      }),
    ).toBe(false);
  });

  it("continues architecture mode when body is truncated even if stop", () => {
    expect(
      shouldContinueArchitectureOutput({
        text: "A".repeat(450) + " with the",
        finishReason: "stop",
        architectureMode: true,
      }),
    ).toBe(true);
  });
});

describe("architectureMaxTokens", () => {
  it("budgets more tokens for detailed mode", () => {
    expect(architectureMaxTokens("detailed")).toBeGreaterThan(
      architectureMaxTokens("medium"),
    );
    expect(architectureMaxTokens("medium")).toBeGreaterThanOrEqual(4096);
  });
});
