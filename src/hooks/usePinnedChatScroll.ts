import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { BOTTOM_PIN_THRESHOLD_PX, isNearBottom } from "../lib/chatKeyboard";

type Options = {
  /** Content that may change height (messages, pending shot, streaming). */
  contentKey: unknown;
  /**
   * When true, growing content must not pull the viewport down.
   * Use while the assistant is streaming so the user can read freely.
   */
  freezeFollow?: boolean;
  /**
   * Changes when a new turn is appended (e.g. messages.length).
   * Scrolls to the bottom once so the new question is visible.
   */
  newTurnKey?: unknown;
};

/**
 * Chat scrolling: one snap to bottom on a new turn; never force-follow
 * while freezeFollow is set. Shows a jump control when newer content is below.
 */
export function usePinnedChatScroll(
  listRef: RefObject<HTMLDivElement | null>,
  { contentKey, freezeFollow = false, newTurnKey }: Options,
) {
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const freezeRef = useRef(freezeFollow);

  useEffect(() => {
    freezeRef.current = freezeFollow;
  }, [freezeFollow]);

  const syncFromDom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setShowJumpToLatest(!isNearBottom(el, BOTTOM_PIN_THRESHOLD_PX));
  }, [listRef]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setShowJumpToLatest(false);
    },
    [listRef],
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const onScroll = () => {
      syncFromDom();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    syncFromDom();
    return () => el.removeEventListener("scroll", onScroll);
  }, [listRef, syncFromDom]);

  // New user turn: show the latest messages once, then leave scroll alone.
  useEffect(() => {
    if (newTurnKey === undefined) return;
    const id = requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
    return () => cancelAnimationFrame(id);
  }, [newTurnKey, scrollToBottom]);

  // While streaming (or otherwise frozen), never yank scroll — only update the button.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    if (freezeRef.current) {
      syncFromDom();
      return;
    }

    // Idle: if the user is already at the bottom, keep them there for quiet updates.
    if (isNearBottom(el, BOTTOM_PIN_THRESHOLD_PX)) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      setShowJumpToLatest(false);
      return;
    }

    setShowJumpToLatest(true);
  }, [contentKey, freezeFollow, listRef, syncFromDom]);

  // Layout growth (Mermaid / images): same freeze rules.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      if (freezeRef.current) {
        syncFromDom();
        return;
      }
      if (isNearBottom(el, BOTTOM_PIN_THRESHOLD_PX)) {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
        setShowJumpToLatest(false);
        return;
      }
      setShowJumpToLatest(true);
    });

    ro.observe(el);
    for (const child of el.children) {
      ro.observe(child);
    }

    return () => ro.disconnect();
  }, [contentKey, listRef, syncFromDom]);

  const jumpToLatest = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  return { showJumpToLatest, jumpToLatest, syncFromDom };
}
