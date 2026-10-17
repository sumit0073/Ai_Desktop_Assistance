/**
 * Detect incomplete model outputs (length-capped streams / mid-sentence cuts).
 * Used to decide whether to request a continuation — no transcript logging.
 */

export type ChatFinishReason =
  | "stop"
  | "length"
  | "content_filter"
  | "tool_calls"
  | "function_call"
  | "unknown"
  | null;

/** Heuristic: response looks cut off before a natural ending. */
export function looksLikeTruncatedOutput(text: string): boolean {
  const t = text.replace(/\s+$/u, "");
  if (!t) return false;

  // Unclosed Mermaid / code fence.
  const fenceCount = (t.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) return true;

  // Ends with a dangling markdown heading or table row separator mid-flow.
  if (/#{1,6}\s+\S[^\n]*$/u.test(t) && !/[.!?]\s*$/u.test(t)) {
    const lastLine = t.split("\n").pop() ?? "";
    if (/^#{1,6}\s+\S/u.test(lastLine.trim()) && lastLine.trim().length < 80) {
      return true;
    }
  }

  // Clear mid-clause endings.
  if (/[,;:—\-–]\s*$/u.test(t)) return true;
  if (
    /\b(the|a|an|and|or|of|to|for|with|in|on|at|by|from|as|is|are|was|were|that|which|this|these|those|into|onto|via|using|including|such|then|when|where|who|whom|whose|how|why|what|can|could|would|should|will|may|might)\s*$/iu.test(
      t,
    )
  ) {
    return true;
  }

  // Long architecture-style answers should end with sentence punctuation or a fence.
  if (t.length >= 400 && !/[.!?`]\s*$/u.test(t) && !/\|\s*$/u.test(t)) {
    return true;
  }

  return false;
}

export function shouldContinueArchitectureOutput(input: {
  text: string;
  finishReason: ChatFinishReason;
  architectureMode: boolean;
}): boolean {
  if (!input.architectureMode) return false;
  if (input.finishReason === "length") return true;
  if (input.finishReason === "stop" || input.finishReason === "content_filter") {
    // Still continue if the body clearly ends mid-sentence (provider quirk).
    return looksLikeTruncatedOutput(input.text);
  }
  if (input.finishReason === null || input.finishReason === "unknown") {
    return looksLikeTruncatedOutput(input.text);
  }
  return looksLikeTruncatedOutput(input.text);
}

export function architectureMaxTokens(detail: "medium" | "detailed"): number {
  return detail === "detailed" ? 6144 : 4096;
}

export const DEFAULT_CHAT_MAX_TOKENS = 2048;
export const CHAT_MAX_TOKENS_MIN = 256;
export const CHAT_MAX_TOKENS_MAX = 8192;
