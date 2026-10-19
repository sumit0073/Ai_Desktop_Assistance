/** Left = glass (5% opaque). Right = solid (100%). Middle default. */
export const CHAT_OVERLAY_SLIDER_MIN = 0;
export const CHAT_OVERLAY_SLIDER_MAX = 100;
export const CHAT_OVERLAY_SLIDER_DEFAULT = 50;
export const CHAT_OVERLAY_OPACITY_MIN = 0.05;
export const CHAT_OVERLAY_OPACITY_MAX = 1;

const STORAGE_KEY = "systembunny.chatOverlaySlider";

export function sliderToOpacity(slider: number): number {
  const t = Math.min(
    CHAT_OVERLAY_SLIDER_MAX,
    Math.max(CHAT_OVERLAY_SLIDER_MIN, slider),
  ) / CHAT_OVERLAY_SLIDER_MAX;
  return (
    CHAT_OVERLAY_OPACITY_MIN +
    t * (CHAT_OVERLAY_OPACITY_MAX - CHAT_OVERLAY_OPACITY_MIN)
  );
}

/**
 * Explicit CSS vars for the chat shell.
 * Must set --glass / --glass-strong as full colors (not nested var()) —
 * otherwise the parent resolves opacity once and the slider never updates.
 */
export function chatOverlayCssVars(
  slider: number,
  theme: "light" | "dark",
): Record<string, string> {
  const opacity = sliderToOpacity(slider);
  const strong = Math.min(1, opacity + 0.04);
  const blurPx = Math.round(12 + (1 - opacity) * 28);
  if (theme === "dark") {
    return {
      "--overlay-opacity": String(opacity),
      "--glass": `rgb(10 20 28 / ${opacity})`,
      "--glass-strong": `rgb(10 20 28 / ${strong})`,
      "--overlay-blur": `${blurPx}px`,
    };
  }
  return {
    "--overlay-opacity": String(opacity),
    "--glass": `rgb(248 251 253 / ${opacity})`,
    "--glass-strong": `rgb(250 252 253 / ${strong})`,
    "--bubble-assistant": `rgb(255 255 255 / ${Math.min(1, opacity + 0.05)})`,
    "--input": `rgb(255 255 255 / ${Math.min(1, opacity + 0.05)})`,
    "--overlay-blur": `${blurPx}px`,
  };
}

export function loadChatOverlaySlider(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return CHAT_OVERLAY_SLIDER_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return CHAT_OVERLAY_SLIDER_DEFAULT;
    return Math.min(
      CHAT_OVERLAY_SLIDER_MAX,
      Math.max(CHAT_OVERLAY_SLIDER_MIN, Math.round(n)),
    );
  } catch {
    return CHAT_OVERLAY_SLIDER_DEFAULT;
  }
}

export function saveChatOverlaySlider(slider: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(slider)));
  } catch {
    // Ignore quota / private mode.
  }
}
