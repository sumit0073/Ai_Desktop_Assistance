/** CSS pixels per Shift+Arrow keypress in the chat list. */
export const CHAT_SCROLL_STEP_PX = 110;

/** Logical pixels per Ctrl/⌘+Arrow window nudge. */
export const WINDOW_NUDGE_STEP_LOGICAL = 30;

/** Distance from bottom (px) that still counts as "pinned". */
export const BOTTOM_PIN_THRESHOLD_PX = 72;

/** Minimum window edge that must stay on a monitor work area (physical px). */
export const MIN_VISIBLE_PHYSICAL_PX = 64;

export type ChatKeyAction =
  | { type: "scroll"; deltaY: number }
  | { type: "nudge"; dxLogical: number; dyLogical: number };

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function isMacPlatform(
  platform = typeof navigator !== "undefined"
    ? navigator.platform || navigator.userAgent
    : "",
): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const el =
    target instanceof HTMLElement
      ? target
      : target.closest?.("input, textarea, select, [contenteditable]") ?? null;
  if (!el) return false;

  if (el instanceof HTMLInputElement) {
    const type = (el.type || "text").toLowerCase();
    if (
      [
        "button",
        "checkbox",
        "radio",
        "submit",
        "reset",
        "file",
        "image",
        "range",
        "color",
        "hidden",
      ].includes(type)
    ) {
      return false;
    }
    return !el.disabled && !el.readOnly;
  }

  if (el instanceof HTMLTextAreaElement) {
    return !el.disabled && !el.readOnly;
  }

  if (el instanceof HTMLSelectElement) {
    return !el.disabled;
  }

  if (el instanceof HTMLElement) {
    const editable = el.getAttribute("contenteditable");
    if (editable === "true" || editable === "") return true;
  }

  return Boolean(el.closest?.('[contenteditable="true"], [contenteditable=""]'));
}

/** Skip app shortcuts when native / nested UI should own the keys. */
export function shouldIgnoreChatShortcut(target: EventTarget | null): boolean {
  if (isEditableTarget(target)) return true;
  if (!(target instanceof Element)) return false;

  if (
    target.closest(
      '[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"], [role="combobox"]',
    )
  ) {
    return true;
  }

  // Nested code / pre blocks that scroll independently.
  if (target.closest(".md pre, .arch-viewer__viewport, .arch-viewer-overlay")) {
    return true;
  }

  return false;
}

/**
 * Map a keydown to chat scroll or window nudge.
 * Requires exact modifiers (no Alt; no Ctrl+Shift combos).
 */
export function resolveChatKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
  >,
  isMac = isMacPlatform(),
): ChatKeyAction | null {
  if (event.altKey) return null;

  const key = event.key;
  const isArrow =
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight";
  if (!isArrow) return null;

  const moveMod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  // Shift+↑/↓ scroll — no Ctrl/Meta.
  if (
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (key === "ArrowUp" || key === "ArrowDown")
  ) {
    return {
      type: "scroll",
      deltaY: key === "ArrowUp" ? -CHAT_SCROLL_STEP_PX : CHAT_SCROLL_STEP_PX,
    };
  }

  // Ctrl (Win/Linux) or ⌘ (macOS) + arrows — window nudge.
  if (moveMod && !event.shiftKey) {
    const step = WINDOW_NUDGE_STEP_LOGICAL;
    switch (key) {
      case "ArrowUp":
        return { type: "nudge", dxLogical: 0, dyLogical: -step };
      case "ArrowDown":
        return { type: "nudge", dxLogical: 0, dyLogical: step };
      case "ArrowLeft":
        return { type: "nudge", dxLogical: -step, dyLogical: 0 };
      case "ArrowRight":
        return { type: "nudge", dxLogical: step, dyLogical: 0 };
      default:
        return null;
    }
  }

  return null;
}

export function isNearBottom(
  el: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  threshold = BOTTOM_PIN_THRESHOLD_PX,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/**
 * Clamp so a useful portion stays on-screen, allowing travel onto adjacent
 * monitors (pick the display whose clamp is closest to the proposed point).
 */
export function clampPhysicalWindowPosition(
  x: number,
  y: number,
  winWidth: number,
  winHeight: number,
  workAreas: Rect[],
  minVisible = MIN_VISIBLE_PHYSICAL_PX,
): { x: number; y: number } {
  if (workAreas.length === 0) {
    return { x, y };
  }

  let best = { x, y };
  let bestDist = Number.POSITIVE_INFINITY;

  for (const area of workAreas) {
    const minX = area.x - winWidth + minVisible;
    const maxX = area.x + area.width - minVisible;
    const minY = area.y - winHeight + minVisible;
    const maxY = area.y + area.height - minVisible;
    const cx = Math.min(Math.max(x, minX), maxX);
    const cy = Math.min(Math.max(y, minY), maxY);
    const dist = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: cx, y: cy };
    }
  }

  return best;
}
