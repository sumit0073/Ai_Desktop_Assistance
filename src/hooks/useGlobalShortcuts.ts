import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { publishShortcut, subscribeShortcut } from "../lib/shortcutBus";

export type ShortcutAction =
  | "screenshot-analyze"
  | "screenshot-error"
  | "analyze-chat";

export type ShortcutEvent = {
  action: ShortcutAction;
  imageBase64?: string;
};

type Handlers = {
  onScreenshotAnalyze?: (imageBase64: string) => void;
  onScreenshotError?: () => void;
  onAnalyzeChat?: () => void;
};

/** Bridge Tauri global-shortcut events into the in-app bus (call once near app root). */
export function useShortcutBridge() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<ShortcutEvent>("seecog://shortcut", (event) => {
      publishShortcut(event.payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Browser preview without Tauri — ignore.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

/** Chat (or other views) subscribe to shortcut actions. */
export function useGlobalShortcuts(handlers: Handlers) {
  const handlersRef = {
    current: handlers,
  };
  handlersRef.current = handlers;

  useEffect(() => {
    return subscribeShortcut((event) => {
      const { action, imageBase64 } = event;
      if (action === "screenshot-analyze" && imageBase64) {
        handlersRef.current.onScreenshotAnalyze?.(imageBase64);
      } else if (action === "screenshot-error") {
        handlersRef.current.onScreenshotError?.();
      } else if (action === "analyze-chat") {
        handlersRef.current.onAnalyzeChat?.();
      }
    });
  }, []);
}
