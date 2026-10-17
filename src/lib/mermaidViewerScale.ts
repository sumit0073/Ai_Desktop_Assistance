/**
 * Deterministic scale helpers for Mermaid architecture diagrams.
 * Keep font readable: never crush the SVG below a floor just to fit.
 */

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.15;
/** Absolute render scale floor (natural SVG size = 1). */
export const MIN_READABLE_SCALE = 0.62;
/** Fit-to-viewport may go lower, but initial zoom compensates. */
export const MIN_FIT_SCALE = 0.22;
export const INLINE_MAX_WIDTH = 960;
export const INLINE_MAX_SCALE = 1.15;
/** Prefer scroll over microscopic text in the chat column. */
export const INLINE_MIN_SCALE = 0.55;

export function clampZoom(n: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n));
}

export function computeFitScale(
  viewport: { clientWidth: number; clientHeight: number } | null,
  natural: { w: number; h: number },
  padding = 56,
): number {
  const { w, h } = natural;
  if (!viewport || !w || !h) return 1;
  const next = Math.min(
    (viewport.clientWidth - padding) / w,
    (viewport.clientHeight - padding) / h,
  );
  if (!Number.isFinite(next) || next <= 0) return 1;
  return Math.max(MIN_FIT_SCALE, next);
}

/**
 * Relative zoom (1 = fitted). When fit would crush text, start above 1 so
 * effective scale ≈ MIN_READABLE_SCALE and the user pans.
 */
export function computeExpandInitialZoom(
  fitScale: number,
  minReadable = MIN_READABLE_SCALE,
): number {
  if (!Number.isFinite(fitScale) || fitScale <= 0) return 1;
  if (fitScale >= minReadable) return 1;
  return clampZoom(minReadable / fitScale);
}

/** Absolute render scale shown to the user (100% = natural SVG). */
export function effectiveScalePercent(fitScale: number, zoom: number): number {
  const eff = fitScale * zoom;
  if (!Number.isFinite(eff) || eff <= 0) return 100;
  return Math.round(eff * 100);
}

/** Zoom factor that renders at ~100% natural size. */
export function computeActualSizeZoom(fitScale: number): number {
  if (!Number.isFinite(fitScale) || fitScale <= 0) return 1;
  return clampZoom(1 / fitScale);
}

export function computeInlineScale(
  hostWidth: number | null | undefined,
  natural: { w: number; h: number },
): number {
  const { w } = natural;
  if (!w) return 1;
  const available = Math.min(
    INLINE_MAX_WIDTH,
    Math.max(200, (hostWidth ?? INLINE_MAX_WIDTH) - 28),
  );
  return Math.min(
    INLINE_MAX_SCALE,
    Math.max(INLINE_MIN_SCALE, available / w),
  );
}
