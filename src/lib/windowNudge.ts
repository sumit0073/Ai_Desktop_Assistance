import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import {
  clampPhysicalWindowPosition,
  type Rect,
} from "./chatKeyboard";

type NudgeResult = "moved" | "skipped-maximized" | "unavailable" | "error";

let busy = false;
let pendingDx = 0;
let pendingDy = 0;

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

async function applyNudgePhysical(
  dxLogical: number,
  dyLogical: number,
): Promise<NudgeResult> {
  if (!isTauriRuntime()) return "unavailable";

  try {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      return "skipped-maximized";
    }

    const [pos, size, scaleFactor, monitors] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
      availableMonitors(),
    ]);

    const dxPhysical = Math.round(dxLogical * scaleFactor);
    const dyPhysical = Math.round(dyLogical * scaleFactor);

    const workAreas: Rect[] = monitors.map((m) => ({
      x: m.workArea.position.x,
      y: m.workArea.position.y,
      width: m.workArea.size.width,
      height: m.workArea.size.height,
    }));

    const next = clampPhysicalWindowPosition(
      pos.x + dxPhysical,
      pos.y + dyPhysical,
      size.width,
      size.height,
      workAreas,
    );

    if (next.x === pos.x && next.y === pos.y) {
      return "moved";
    }

    await win.setPosition(new PhysicalPosition(next.x, next.y));
    return "moved";
  } catch {
    return "error";
  }
}

/**
 * Queue a logical-pixel window nudge. Concurrent calls coalesce so key-repeat
 * does not flood Tauri with overlapping setPosition requests.
 */
export async function nudgeWindowByLogical(
  dxLogical: number,
  dyLogical: number,
): Promise<void> {
  pendingDx += dxLogical;
  pendingDy += dyLogical;
  if (busy) return;

  busy = true;
  try {
    while (pendingDx !== 0 || pendingDy !== 0) {
      const dx = pendingDx;
      const dy = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      await applyNudgePhysical(dx, dy);
    }
  } finally {
    busy = false;
  }
}

/** Test-only: reset coalescing state between cases. */
export function __resetWindowNudgeStateForTests(): void {
  busy = false;
  pendingDx = 0;
  pendingDy = 0;
}
