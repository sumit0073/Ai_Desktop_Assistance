import type { ShortcutEvent } from "../hooks/useGlobalShortcuts";

type Listener = (event: ShortcutEvent) => void;

const listeners = new Set<Listener>();
const queue: ShortcutEvent[] = [];

export function publishShortcut(event: ShortcutEvent) {
  if (listeners.size === 0) {
    queue.push(event);
    // Cap memory if the user hammers shortcuts before opening chat.
    if (queue.length > 8) queue.splice(0, queue.length - 8);
    return;
  }
  listeners.forEach((listener) => listener(event));
}

export function subscribeShortcut(listener: Listener): () => void {
  listeners.add(listener);
  if (queue.length > 0) {
    const pending = queue.splice(0, queue.length);
    pending.forEach((event) => listener(event));
  }
  return () => {
    listeners.delete(listener);
  };
}
