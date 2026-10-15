import { describe, expect, it } from "vitest";
import {
  classifyMicLevel,
  normalizeMicRms,
  rmsFromTimeDomain,
} from "./micLevel";

describe("micLevel", () => {
  it("classifies quiet / good / hot bands", () => {
    expect(classifyMicLevel(0)).toBe("silent");
    expect(classifyMicLevel(0.12)).toBe("quiet");
    expect(classifyMicLevel(0.45)).toBe("good");
    expect(classifyMicLevel(0.9)).toBe("hot");
  });

  it("computes RMS from time-domain samples", () => {
    const silent = new Float32Array(4);
    expect(rmsFromTimeDomain(silent)).toBe(0);

    const loud = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    expect(rmsFromTimeDomain(loud)).toBeCloseTo(0.5, 5);
  });

  it("normalizes RMS into a clamped 0–1 fill", () => {
    expect(normalizeMicRms(0)).toBe(0);
    expect(normalizeMicRms(0.1, 6.5)).toBeCloseTo(0.65, 5);
    expect(normalizeMicRms(1, 6.5)).toBe(1);
  });
});
