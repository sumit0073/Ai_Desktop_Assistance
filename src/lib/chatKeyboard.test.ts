import { describe, expect, it } from "vitest";
import {
  CHAT_SCROLL_STEP_PX,
  WINDOW_NUDGE_STEP_LOGICAL,
  clampPhysicalWindowPosition,
  isMacPlatform,
  isNearBottom,
  resolveChatKeyAction,
} from "./chatKeyboard";

function keyEvent(
  partial: Partial<
    Pick<
      KeyboardEvent,
      "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
    >
  >,
) {
  return {
    key: "ArrowUp",
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...partial,
  };
}

describe("isMacPlatform", () => {
  it("detects mac user agents", () => {
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("iPhone")).toBe(true);
    expect(isMacPlatform("Win32")).toBe(false);
    expect(isMacPlatform("Linux x86_64")).toBe(false);
  });
});

describe("resolveChatKeyAction", () => {
  it("maps Shift+ArrowUp/Down to chat scroll steps", () => {
    expect(resolveChatKeyAction(keyEvent({ key: "ArrowUp", shiftKey: true }))).toEqual({
      type: "scroll",
      deltaY: -CHAT_SCROLL_STEP_PX,
    });
    expect(
      resolveChatKeyAction(keyEvent({ key: "ArrowDown", shiftKey: true })),
    ).toEqual({
      type: "scroll",
      deltaY: CHAT_SCROLL_STEP_PX,
    });
  });

  it("ignores Shift+ArrowLeft/Right", () => {
    expect(
      resolveChatKeyAction(keyEvent({ key: "ArrowLeft", shiftKey: true })),
    ).toBeNull();
  });

  it("maps Ctrl+arrows to window nudge on Windows/Linux", () => {
    expect(
      resolveChatKeyAction(
        keyEvent({ key: "ArrowRight", ctrlKey: true }),
        false,
      ),
    ).toEqual({
      type: "nudge",
      dxLogical: WINDOW_NUDGE_STEP_LOGICAL,
      dyLogical: 0,
    });
    expect(
      resolveChatKeyAction(keyEvent({ key: "ArrowUp", ctrlKey: true }), false),
    ).toEqual({
      type: "nudge",
      dxLogical: 0,
      dyLogical: -WINDOW_NUDGE_STEP_LOGICAL,
    });
  });

  it("maps Command+arrows to window nudge on macOS", () => {
    expect(
      resolveChatKeyAction(keyEvent({ key: "ArrowLeft", metaKey: true }), true),
    ).toEqual({
      type: "nudge",
      dxLogical: -WINDOW_NUDGE_STEP_LOGICAL,
      dyLogical: 0,
    });
  });

  it("does not treat Ctrl+Arrow as nudge on macOS", () => {
    expect(
      resolveChatKeyAction(keyEvent({ key: "ArrowDown", ctrlKey: true }), true),
    ).toBeNull();
  });

  it("does not treat Meta+Arrow as nudge on Windows", () => {
    expect(
      resolveChatKeyAction(
        keyEvent({ key: "ArrowDown", metaKey: true }),
        false,
      ),
    ).toBeNull();
  });

  it("ignores combos that would conflict with text editing modifiers", () => {
    expect(
      resolveChatKeyAction(
        keyEvent({ key: "ArrowUp", shiftKey: true, ctrlKey: true }),
        false,
      ),
    ).toBeNull();
    expect(
      resolveChatKeyAction(
        keyEvent({ key: "ArrowUp", ctrlKey: true, altKey: true }),
        false,
      ),
    ).toBeNull();
    expect(
      resolveChatKeyAction(
        keyEvent({ key: "ArrowUp", shiftKey: true, metaKey: true }),
        true,
      ),
    ).toBeNull();
  });

  it("ignores plain arrows", () => {
    expect(resolveChatKeyAction(keyEvent({ key: "ArrowUp" }))).toBeNull();
  });
});

describe("isNearBottom", () => {
  it("treats the viewport as pinned near the bottom", () => {
    expect(
      isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }, 20),
    ).toBe(true);
    expect(
      isNearBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 100 }, 20),
    ).toBe(false);
  });

  it("supports jump-to-latest visibility via inverse of pin", () => {
    const away = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 };
    expect(isNearBottom(away)).toBe(false);
  });
});

describe("clampPhysicalWindowPosition", () => {
  const monitor = { x: 0, y: 0, width: 1920, height: 1080 };

  it("keeps a useful portion of the window on the work area", () => {
    const clamped = clampPhysicalWindowPosition(
      -5000,
      -5000,
      800,
      600,
      [monitor],
      64,
    );
    expect(clamped.x).toBe(0 - 800 + 64);
    expect(clamped.y).toBe(0 - 600 + 64);
  });

  it("accounts for multi-monitor origins", () => {
    const right = { x: 1920, y: 0, width: 1920, height: 1080 };
    const clamped = clampPhysicalWindowPosition(
      2500,
      100,
      800,
      600,
      [monitor, right],
      64,
    );
    expect(clamped.x).toBeGreaterThanOrEqual(1920 - 800 + 64);
    expect(clamped.x).toBeLessThanOrEqual(1920 + 1920 - 64);
    expect(clamped.y).toBe(100);
  });

  it("can travel onto an adjacent monitor instead of sticking to the first", () => {
    const right = { x: 1920, y: 0, width: 1920, height: 1080 };
    // Sliding past the right edge of the primary — nearest clamp is on `right`.
    const clamped = clampPhysicalWindowPosition(
      1800,
      100,
      800,
      600,
      [monitor, right],
      64,
    );
    expect(clamped.x).toBeGreaterThanOrEqual(1920 - 800 + 64);
    expect(clamped.y).toBe(100);
  });

  it("applies logical step scaling when converting to physical deltas", () => {
    const scaleFactor = 1.5;
    const dxPhysical = Math.round(WINDOW_NUDGE_STEP_LOGICAL * scaleFactor);
    expect(dxPhysical).toBe(45);
    const next = clampPhysicalWindowPosition(
      100 + dxPhysical,
      200,
      800,
      600,
      [monitor],
    );
    expect(next).toEqual({ x: 145, y: 200 });
  });

  it("returns the input when no monitors are available", () => {
    expect(clampPhysicalWindowPosition(10, 20, 100, 100, [])).toEqual({
      x: 10,
      y: 20,
    });
  });
});
