import { describe, expect, it } from "vitest";
import { SttRollingContext } from "./sttRollingContext";

describe("SttRollingContext", () => {
  it("keeps microphone and meeting context separate", () => {
    const ctx = new SttRollingContext(3, 240);
    ctx.reset("s1");
    ctx.push("microphone", "I am speaking about APIs", { trusted: true });
    ctx.push("meeting", "What is the Fibonacci sequence?", { trusted: true });
    expect(ctx.getPromptContext("microphone")).toContain("APIs");
    expect(ctx.getPromptContext("microphone")).not.toContain("Fibonacci");
    expect(ctx.getPromptContext("meeting")).toContain("Fibonacci");
    expect(ctx.getPromptContext("meeting")).not.toContain("APIs");
  });

  it("excludes untrusted and uncertain text", () => {
    const ctx = new SttRollingContext();
    ctx.reset("s1");
    ctx.push("meeting", "bad recognition about book series", {
      trusted: true,
      uncertain: true,
    });
    ctx.push("meeting", "", { trusted: true });
    ctx.push("meeting", "failed", { trusted: false });
    expect(ctx.getPromptContext("meeting")).toBe("");
    ctx.push("meeting", "What is binary search?", { trusted: true });
    expect(ctx.getPromptContext("meeting")).toBe("What is binary search?");
  });

  it("resets on new session and clears on stop", () => {
    const ctx = new SttRollingContext(2, 240);
    ctx.reset("s1");
    ctx.push("meeting", "first", { trusted: true });
    ctx.reset("s2");
    expect(ctx.getPromptContext("meeting")).toBe("");
    ctx.push("meeting", "second", { trusted: true });
    ctx.clear();
    expect(ctx.getSessionId()).toBe("");
    expect(ctx.getPromptContext("meeting")).toBe("");
  });

  it("limits segment count", () => {
    const ctx = new SttRollingContext(2, 400);
    ctx.reset("s1");
    ctx.push("meeting", "one", { trusted: true });
    ctx.push("meeting", "two", { trusted: true });
    ctx.push("meeting", "three", { trusted: true });
    const snap = ctx.snapshot();
    expect(snap.meeting).toEqual(["two", "three"]);
  });
});
