import { isMacPlatform } from "./chatKeyboard";

/**
 * Build target from `tauri build` / `tauri dev` (Vite inlines this).
 * Mac DMG → "darwin"; Windows EXE/MSI → "windows".
 * Undefined under plain Vite / Vitest — fall back to the runtime OS.
 */
function tauriBuildPlatform(): string | undefined {
  const value = import.meta.env.TAURI_ENV_PLATFORM;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** True for macOS DMG / Apple Silicon / Intel Mac builds. */
export function isMacBuild(): boolean {
  const build = tauriBuildPlatform();
  if (build === "darwin") return true;
  if (build === "windows" || build === "linux") return false;
  return isMacPlatform();
}

/** True for Windows NSIS / MSI builds. */
export function isWindowsBuild(): boolean {
  const build = tauriBuildPlatform();
  if (build === "windows") return true;
  if (build === "darwin" || build === "linux") return false;
  return !isMacPlatform();
}

export function appPlatformLabel(): "Mac" | "Windows" {
  return isMacBuild() ? "Mac" : "Windows";
}

/** Deep link to the OS microphone privacy pane for this build only. */
export function microphoneSettingsUrl(): string {
  return isMacBuild()
    ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
    : "ms-settings:privacy-microphone";
}
