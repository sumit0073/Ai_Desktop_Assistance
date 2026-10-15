import { isMacPlatform } from "./chatKeyboard";

export type AppShortcutRow = {
  keys: string;
  action: string;
};

/** Platform-specific chords only — Windows builds show Ctrl, Mac builds show ⌘. */
export function getAppShortcutRows(isMac = isMacPlatform()): AppShortcutRow[] {
  const mod = isMac ? "⌘" : "Ctrl";
  return [
    {
      keys: `${mod}+Shift+A`,
      action: "Hide or show the overlay",
    },
    {
      keys: `${mod}+H`,
      action: "Capture the desktop, then send to AI",
    },
    {
      keys: `${mod}+G`,
      action:
        "Start or stop Record (mic + meeting audio). Press again to stop",
    },
    {
      keys: "Enter",
      action: "In chat: add your typed note as a message bubble (does not ask AI)",
    },
    {
      keys: `${mod}+Enter`,
      action:
        "Ask AI (last few Them/You lines + composer text). Shows Asking AI… then answer on the left",
    },
    {
      keys: "Shift+↑",
      action: "Hold to scroll up (chat, Shortcuts, or History)",
    },
    {
      keys: "Shift+↓",
      action: "Hold to scroll down (chat, Shortcuts, or History)",
    },
    {
      keys: `${mod}+↑`,
      action: "Hold to nudge overlay up (stays on-screen)",
    },
    {
      keys: `${mod}+↓`,
      action: "Hold to nudge overlay down (stays on-screen)",
    },
    {
      keys: `${mod}+←`,
      action: "Hold to nudge overlay left (can cross displays)",
    },
    {
      keys: `${mod}+→`,
      action: "Hold to nudge overlay right (can cross displays)",
    },
  ];
}

export function appShortcutPlatformLabel(isMac = isMacPlatform()): string {
  return isMac ? "Mac" : "Windows";
}
