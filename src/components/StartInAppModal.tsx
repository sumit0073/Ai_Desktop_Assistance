import { useEffect, useRef, type ReactNode } from "react";
import { subscribeShortcut } from "../lib/shortcutBus";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

const PANEL_SCROLL_STEP_PX = 80;

function scrollPanel(
  body: HTMLDivElement | null,
  direction: "up" | "down",
): void {
  if (!body) return;
  const nested = body.querySelector(
    ".start-modal__scroll",
  ) as HTMLElement | null;
  const el = nested ?? body;
  el.scrollBy({
    top: direction === "up" ? -PANEL_SCROLL_STEP_PX : PANEL_SCROLL_STEP_PX,
    left: 0,
    behavior: "auto",
  });
}

/** In-window sheet — stays inside the System Bunny card (not an OS popup). */
export function StartInAppModal({ title, onClose, children }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Tauri registers Shift+↑/↓ as global shortcuts, so the webview often never
    // sees those keydowns. Also listen on the shortcut bus (same path as chat).
    const unsub = subscribeShortcut((event) => {
      if (event.action === "scroll-chat-up") {
        scrollPanel(bodyRef.current, "up");
      } else if (event.action === "scroll-chat-down") {
        scrollPanel(bodyRef.current, "down");
      }
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      // Browser / cases where the key still reaches the webview.
      if (
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        event.stopPropagation();
        scrollPanel(
          bodyRef.current,
          event.key === "ArrowUp" ? "up" : "down",
        );
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      unsub();
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      className="start-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="start-modal__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="start-modal__panel">
        <header className="start-modal__header">
          <h2 className="start-modal__title">{title}</h2>
          <button
            type="button"
            className="start-modal__close"
            onClick={onClose}
            aria-label="Close panel"
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path
                d="M1.5 1.5l9 9M10.5 1.5l-9 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="start-modal__body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
