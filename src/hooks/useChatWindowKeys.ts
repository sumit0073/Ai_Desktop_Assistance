import { useEffect, type RefObject } from "react";
import {
  isMacPlatform,
  resolveChatKeyAction,
  shouldIgnoreChatShortcut,
} from "../lib/chatKeyboard";
import { nudgeWindowByLogical } from "../lib/windowNudge";

/**
 * Local (webview-only) keyboard shortcuts:
 * - Shift+↑/↓ scroll the chat list
 * - Ctrl+arrows (Win/Linux) or ⌘+arrows (macOS) nudge the desktop window
 */
export function useChatWindowKeys(
  listRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const isMac = isMacPlatform();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (shouldIgnoreChatShortcut(event.target)) return;

      const action = resolveChatKeyAction(event, isMac);
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();

      if (action.type === "scroll") {
        const el = listRef.current;
        if (!el) return;
        // `auto` stays responsive under OS key-repeat; smooth queues poorly.
        el.scrollBy({ top: action.deltaY, left: 0, behavior: "auto" });
        return;
      }

      void nudgeWindowByLogical(action.dxLogical, action.dyLogical);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listRef]);
}
