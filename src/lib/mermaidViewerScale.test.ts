import { describe, expect, it } from "vitest";
import {
  clampZoom,
  computeActualSizeZoom,
  computeExpandInitialZoom,
  computeFitScale,
  computeInlineScale,
  effectiveScalePercent,
  INLINE_MIN_SCALE,
  MIN_READABLE_SCALE,
} from "./mermaidViewerScale";

describe("mermaidViewerScale", () => {
  it("fits within the viewport with padding", () => {
    const scale = computeFitScale(
      { clientWidth: 1000, clientHeight: 800 },
      { w: 2000, h: 1000 },
    );
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0.2);
  });

  it("starts expandable zoom above 1 when fit would crush text", () => {
    const fit = 0.3;
    const zoom = computeExpandInitialZoom(fit);
    expect(zoom).toBeGreaterThan(1);
    expect(fit * zoom).toBeCloseTo(MIN_READABLE_SCALE, 2);
  });

  it("keeps zoom at 1 when fit is already readable", () => {
    expect(computeExpandInitialZoom(0.8)).toBe(1);
  });

  it("reports absolute percent of natural size", () => {
    expect(effectiveScalePercent(0.5, 1)).toBe(50);
    expect(effectiveScalePercent(0.5, 2)).toBe(100);
  });

  it("maps actual-size zoom from fit scale", () => {
    expect(computeActualSizeZoom(0.5)).toBe(2);
    expect(clampZoom(computeActualSizeZoom(0.1))).toBeLessThanOrEqual(4);
  });

  it("does not shrink inline diagrams below the readable floor", () => {
    const scale = computeInlineScale(320, { w: 2000, h: 900 });
    expect(scale).toBe(INLINE_MIN_SCALE);
  });
});
