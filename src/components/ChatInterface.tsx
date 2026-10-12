import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useWorkSession } from "../context/WorkSessionContext";
import { useChatWindowKeys } from "../hooks/useChatWindowKeys";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { usePinnedChatScroll } from "../hooks/usePinnedChatScroll";
import { analyzeWithAi, hasMermaidBlock, type ArchitectureDetail } from "../lib/ai";
import { MarkdownMessage } from "./MarkdownMessage";
import { ProfileMenu } from "./ProfileMenu";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageBase64?: string;
  streaming?: boolean;
};

const STARTER: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Shortcuts: Ctrl/⌘+Shift+A hides or shows this window · Ctrl/⌘+H captures the screen · Ctrl/⌘+G asks the AI (or clears if empty) · Shift+↑/↓ scrolls chat · Ctrl/⌘+arrows move the window. Close quits the app.",
};

function screenshotDataUrl(base64: string): string {
  const mime = base64.startsWith("/9j/") ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${base64}`;
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const modLabel = isMac ? "⌘" : "Ctrl";

export function ChatInterface() {
  const { user } = useAuth();
  const { stopSession } = useWorkSession();
  const [messages, setMessages] = useState<ChatMessage[]>([STARTER]);
  const [input, setInput] = useState("");
  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  const pendingRef = useRef(pendingScreenshot);
  const sendingRef = useRef(sending);
  const contentKey = `${messages.length}:${messages[messages.length - 1]?.content.length ?? 0}:${pendingScreenshot ? 1 : 0}:${sending ? 1 : 0}`;
  const { showJumpToLatest, jumpToLatest } = usePinnedChatScroll(listRef, {
    contentKey,
    // While the assistant streams, do not force the viewport down.
    freezeFollow: sending,
    // Snap once when a new turn is appended so the question is visible.
    newTurnKey: messages.length,
  });

  useChatWindowKeys(listRef);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    pendingRef.current = pendingScreenshot;
  }, [pendingScreenshot]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  const resetView = () => {
    setMessages([STARTER]);
    setInput("");
    setPendingScreenshot(null);
    setSending(false);
  };

  const runAnalysis = async (
    prompt: string,
    imageBase64: string | null,
    options?: {
      forceArchitecture?: boolean;
      architectureDetail?: ArchitectureDetail;
    },
  ) => {
    if (sendingRef.current) return;

    const trimmed = prompt.trim();
    const hasScreenshot = Boolean(imageBase64);

    // Cmd/Ctrl+G with an empty chat clears / resets the view.
    if (!trimmed && !hasScreenshot && !options?.forceArchitecture) {
      resetView();
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed || "Analyze this screen capture.",
      imageBase64: imageBase64 ?? undefined,
    };

    // Capture prior turns before appending the new user message (state is still previous).
    const history = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({
        role: m.role,
        content: m.content,
        imageBase64: m.imageBase64,
      }));

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
      },
    ]);
    setInput("");
    setPendingScreenshot(null);
    setSending(true);

    let raf = 0;
    let latestChunk = "";
    const pushChunk = (text: string) => {
      latestChunk = text;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = latestChunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: next, streaming: true } : m,
          ),
        );
      });
    };

    try {
      const reply = await analyzeWithAi({
        prompt: trimmed,
        imageBase64,
        hasScreenshot,
        history,
        onChunk: pushChunk,
        forceArchitecture: options?.forceArchitecture,
        architectureDetail: options?.architectureDetail,
      });
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: reply, streaming: false }
            : m,
        ),
      );
    } catch (error) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Analysis failed. Try again in a moment.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: message, streaming: false }
            : m,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const expandArchitecture = (mode: "full" | "subsystem") => {
    if (sendingRef.current) return;
    const prompt =
      mode === "subsystem"
        ? "Zoom into the most critical subsystem from the previous architecture. Preserve existing component names and show how that subsystem connects to the rest of the system."
        : "Give a more detailed architecture for the same system. Preserve existing component names and boundaries. Add relevant services, data ownership, messaging, integrations, workflows, scaling, and reliability — keep the diagram readable.";
    void runAnalysis(prompt, null, {
      forceArchitecture: true,
      architectureDetail: "detailed",
    });
  };

  useGlobalShortcuts({
    onScreenshotAnalyze: (imageBase64) => {
      // Cmd/Ctrl+H: capture any screen and send it to the AI immediately.
      void runAnalysis("", imageBase64);
    },
    onScreenshotError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Could not capture the screen. Check display permissions and try again.",
        },
      ]);
    },
    onAnalyzeChat: () => {
      // Cmd/Ctrl+G: send the chat question (and any pending shot) to the AI.
      void runAnalysis(inputRef.current, pendingRef.current);
    },
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await runAnalysis(input, pendingScreenshot);
  };

  return (
    <div className="shell chat">
      <aside className="chat-glass chat-glass--fullscreen">
        <header className="topbar" data-tauri-drag-region>
          <div className="topbar__leading">
            <button
              type="button"
              className="stop-button"
              onClick={() => void stopSession()}
              title="End session and return to start"
            >
              Stop
            </button>
            <div className="chat-heading">
              <h1>System Bunny</h1>
              <p>{user?.email ?? "Session active"}</p>
            </div>
          </div>
          <div className="topbar__actions">
            <ThemeToggle />
            <ProfileMenu />
            <WindowControls />
          </div>
        </header>

        <div className="shortcut-bar" data-tauri-drag-region>
          <span>
            <kbd>{modLabel}</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> hide/show
          </span>
          <span>
            <kbd>{modLabel}</kbd>+<kbd>H</kbd> capture
          </span>
          <span>
            <kbd>{modLabel}</kbd>+<kbd>G</kbd> ask AI
          </span>
          <span>
            <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> scroll
          </span>
          <span>
            <kbd>{modLabel}</kbd>+<kbd>↑↓←→</kbd> move
          </span>
        </div>

        <div className="chat-messages-shell">
          <div className="chat-messages" ref={listRef}>
            {messages.map((message) => (
              <article
                key={message.id}
                className={`bubble bubble--${message.role}`}
              >
                <span className="bubble__role">
                  {message.role === "assistant" ? "Assistant" : "You"}
                </span>
                {message.imageBase64 && (
                  <img
                    className="bubble__shot"
                    src={screenshotDataUrl(message.imageBase64)}
                    alt="Captured screen"
                  />
                )}
                {message.role === "assistant" ? (
                  <>
                    <MarkdownMessage
                      content={message.content}
                      streaming={message.streaming}
                    />
                    {!message.streaming &&
                      hasMermaidBlock(message.content) && (
                        <div className="architecture-actions">
                          <button
                            type="button"
                            className="btn btn-ghost architecture-actions__btn"
                            disabled={sending}
                            onClick={() => expandArchitecture("full")}
                          >
                            {sending ? "Working…" : "More Detail"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost architecture-actions__btn"
                            disabled={sending}
                            onClick={() => expandArchitecture("subsystem")}
                          >
                            Key subsystem
                          </button>
                        </div>
                      )}
                  </>
                ) : (
                  <p>{message.content}</p>
                )}
              </article>
            ))}
            {pendingScreenshot && (
              <article className="bubble bubble--user">
                <span className="bubble__role">Pending capture</span>
                <img
                  className="bubble__shot"
                  src={screenshotDataUrl(pendingScreenshot)}
                  alt="Pending screenshot"
                />
                <p>Ready for {modLabel}+G analysis</p>
              </article>
            )}
          </div>
          {showJumpToLatest && (
            <button
              type="button"
              className="chat-jump-latest"
              onClick={jumpToLatest}
            >
              ↓ Latest message
            </button>
          )}
        </div>

        <form className="chat-composer" onSubmit={onSubmit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask System Bunny… (${modLabel}+G)`}
            aria-label="Message"
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={sending || (!input.trim() && !pendingScreenshot)}
          >
            Send
          </button>
        </form>
      </aside>
    </div>
  );
}
