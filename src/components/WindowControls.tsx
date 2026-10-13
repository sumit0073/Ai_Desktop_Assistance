import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  const toggleHideShow = async () => {
    try {
      await invoke("toggle_main_window");
    } catch {
      // Browser preview — ignore.
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const syncMaximized = async () => {
      try {
        const value = await getCurrentWindow().isMaximized();
        if (!cancelled) setMaximized(value);
      } catch {
        // Browser preview or window not ready.
      }
    };

    void syncMaximized();

    try {
      getCurrentWindow()
        .onResized(() => {
          void syncMaximized();
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // getCurrentWindow unavailable outside Tauri.
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      const window = getCurrentWindow();
      const isMax = await window.isMaximized();
      if (isMax) {
        await window.unmaximize();
        setMaximized(false);
      } else {
        await window.maximize();
        setMaximized(true);
      }
    } catch {
      // Browser preview — ignore.
    }
  };

  const close = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      // Browser preview — ignore.
    }
  };

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        className="window-controls__btn window-controls__btn--hide"
        onClick={() => void toggleHideShow()}
        aria-label="Hide overlay"
        title="Hide overlay (Ctrl/⌘+Shift+A)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2 6.5h8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="window-controls__btn window-controls__btn--max"
        onClick={toggleFullscreen}
        aria-label={maximized ? "Restore" : "Fullscreen"}
        title={maximized ? "Restore" : "Fullscreen"}
      >
        {maximized ? (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M3.5 4.5h5v5h-5zM3.5 4.5V3h5.5v5.5H8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect
              x="2.25"
              y="2.25"
              width="7.5"
              height="7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-controls__btn window-controls__btn--close"
        onClick={close}
        aria-label="Close"
        title="Close"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M1.5 1.5l9 9M10.5 1.5l-9 9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
