import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAuth } from "../context/AuthContext";
import { useWorkSession } from "../context/WorkSessionContext";
import { useChatWindowKeys } from "../hooks/useChatWindowKeys";
import { useComposerVoiceInput } from "../hooks/useComposerVoiceInput";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useMeetingCapture } from "../hooks/useMeetingCapture";
import { usePinnedChatScroll } from "../hooks/usePinnedChatScroll";
import { analyzeWithAi, hasMermaidBlock, type ArchitectureDetail } from "../lib/ai";
import { CHAT_SCROLL_STEP_PX } from "../lib/chatKeyboard";
import {
  buildPromptFromSelection,
  logAskAiDiagnostics,
  selectAskAiTarget,
} from "../lib/askAboutConversation";
import { looksLikeArchitecture } from "../lib/architectureDetect";
import { decideAskAudienceQuestion } from "../lib/askQuestionFlow";
import {
  extractAudienceQuestions,
  type ExtractedQuestion,
} from "../lib/extractAudienceQuestions";
import { isMicBleedFromAudience } from "../lib/sanitizeTranscript";
import { SttRollingContext } from "../lib/sttRollingContext";
import { transcribeAudioBlob } from "../lib/transcribeAudio";
import {
  reconcileSegmentOverlap,
  type AudioLane,
} from "../lib/transcriptOverlap";
import { ComposerMicIcon } from "./ComposerMicIcon";
import { MarkdownMessage } from "./MarkdownMessage";
import { ProfileMenu } from "./ProfileMenu";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";

type Speaker = "them" | "me" | "assistant";

type ChatMessage = {
  id: string;
  /** Mapped into the AI API: them/me → user, assistant → assistant. */
  role: "user" | "assistant";
  speaker: Speaker;
  /** Display transcript after safe overlap trim (never an LLM rewrite). */
  content: string;
  /** Raw STT text before hallucination filters, when from speech. */
  originalContent?: string;
  /** Text before overlap reconciliation (audit). */
  preDedupContent?: string;
  audioSource?: AudioLane;
  captureSessionId?: string;
  startedAtMs?: number;
  endedAtMs?: number;
  imageBase64?: string;
  streaming?: boolean;
  /** Structured questions tied to this transcript. */
  questions?: ExtractedQuestion[];
};

function speakerToLane(who: "them" | "me"): AudioLane {
  return who === "them" ? "meeting" : "microphone";
}

function screenshotDataUrl(base64: string): string {
  const mime = base64.startsWith("/9j/") ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${base64}`;
}

function toHistoryEntry(m: ChatMessage) {
  if (m.speaker === "assistant") {
    return { role: "assistant" as const, content: m.content };
  }
  const who = m.speaker === "them" ? "Them" : "Me";
  return {
    role: "user" as const,
    content: `${who}: ${m.content}`,
    imageBase64: m.imageBase64,
  };
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const modLabel = isMac ? "⌘" : "Ctrl";

export function ChatInterface() {
  const { user } = useAuth();
  const { stopSession } = useWorkSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  /** Question ids already sent to the AI (hide from the open-question tray). */
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<string[]>([]);
  /** Inline edit buffer for a question chip. */
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
    null,
  );
  const [editingQuestionText, setEditingQuestionText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  const pendingRef = useRef(pendingScreenshot);
  const sendingRef = useRef(sending);
  const messagesRef = useRef(messages);
  /** Recent audience (speaker) lines — used to drop mic echo/bleed. */
  const recentAudienceRef = useRef<string[]>([]);
  /** Recent same-source UI texts for repeated weak-phrase STT rejection. */
  const recentMicTextsRef = useRef<string[]>([]);
  const recentMeetingTextsRef = useRef<string[]>([]);
  /** Per-source rolling STT context (never mixes mic ↔ meeting). */
  const sttContextRef = useRef(new SttRollingContext());
  const lastSegmentRef = useRef<{
    microphone?: ChatMessage;
    meeting?: ChatMessage;
  }>({});
  /** Live STT bubble per lane (partials update in place until final). */
  const liveUtteranceRef = useRef<{
    microphone?: { messageId: string; utteranceId: string };
    meeting?: { messageId: string; utteranceId: string };
  }>({});
  /** Drop late partials after a final for the same utterance has landed. */
  const finalizedUtterancesRef = useRef<Set<string>>(new Set());

  /** Audience texts for bleed checks: recent finals + live meeting draft. */
  const audienceTextsForBleed = useCallback((): string[] => {
    const liveMeetingId = liveUtteranceRef.current.meeting?.messageId;
    const liveMeeting = liveMeetingId
      ? messagesRef.current.find((m) => m.id === liveMeetingId)?.content
      : undefined;
    return [liveMeeting, ...recentAudienceRef.current].filter(
      (t): t is string => Boolean(t?.trim()),
    );
  }, []);

  const dropMicIfBleed = useCallback(
    (text: string, utteranceId?: string): boolean => {
      if (!isMicBleedFromAudience(text, audienceTextsForBleed())) return false;
      const live = liveUtteranceRef.current.microphone;
      if (live && (!utteranceId || live.utteranceId === utteranceId)) {
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== live.messageId);
          messagesRef.current = next;
          return next;
        });
        liveUtteranceRef.current.microphone = undefined;
      }
      return true;
    },
    [audienceTextsForBleed],
  );
  const contentKey = `${messages.length}:${messages[messages.length - 1]?.content.length ?? 0}:${pendingScreenshot ? 1 : 0}:${sending ? 1 : 0}`;
  const { showJumpToLatest, jumpToLatest } = usePinnedChatScroll(listRef, {
    contentKey,
    freezeFollow: sending,
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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const resetView = () => {
    setMessages([]);
    setInput("");
    setPendingScreenshot(null);
    setSending(false);
    setMicStatus(null);
    setAnsweredQuestionIds([]);
    setEditingQuestionId(null);
    setEditingQuestionText("");
    sttContextRef.current.clear();
    lastSegmentRef.current = {};
    recentAudienceRef.current = [];
    recentMicTextsRef.current = [];
    recentMeetingTextsRef.current = [];
  };

  const openQuestions = messages
    .filter((m) => m.speaker === "them" && m.questions?.length)
    .flatMap((m) => m.questions ?? [])
    .filter((q) => !answeredQuestionIds.includes(q.questionId));

  const appendSpeakerMessage = useCallback(
    (
      text: string,
      who: "them" | "me",
      imageBase64?: string | null,
      meta?: {
        originalText?: string;
        sessionId?: string;
        startedAtMs?: number;
        endedAtMs?: number;
      },
    ) => {
      const preDedup = text.trim();
      if (!preDedup && !imageBase64) return;

      const lane = speakerToLane(who);
      const sessionId =
        meta?.sessionId || sttContextRef.current.getSessionId() || "manual";
      let trimmed = preDedup;

      if (trimmed) {
        const prev = lastSegmentRef.current[lane];
        const reconciled = reconcileSegmentOverlap(
          prev
            ? {
                text: prev.content,
                originalText: prev.originalContent,
                source: lane,
                sessionId: prev.captureSessionId || sessionId,
                startedAtMs: prev.startedAtMs,
                endedAtMs: prev.endedAtMs,
              }
            : null,
          {
            text: trimmed,
            originalText: meta?.originalText,
            source: lane,
            sessionId,
            startedAtMs: meta?.startedAtMs,
            endedAtMs: meta?.endedAtMs,
          },
        );
        trimmed = reconciled.text;
        if (!trimmed && !imageBase64) return;
      }

      const msgId = crypto.randomUUID();
      const recentContext = messagesRef.current
        .filter((m) => m.id !== "welcome" && m.content.trim())
        .slice(-6)
        .map((m) => m.content);

      const questions =
        who === "them" && trimmed
          ? extractAudienceQuestions(trimmed, {
              sourceTranscriptId: msgId,
              recentContext,
            })
          : undefined;

      const msg: ChatMessage = {
        id: msgId,
        role: "user",
        speaker: who,
        content: trimmed || (imageBase64 ? "Screen capture attached." : ""),
        originalContent: meta?.originalText?.trim() || undefined,
        preDedupContent: preDedup || undefined,
        audioSource: lane,
        captureSessionId: sessionId,
        startedAtMs: meta?.startedAtMs,
        endedAtMs: meta?.endedAtMs,
        imageBase64: imageBase64 ?? undefined,
        questions: questions?.length ? questions : undefined,
      };
      setMessages((prev) => [...prev, msg]);
      setInput("");
      setPendingScreenshot(null);
      lastSegmentRef.current[lane] = msg;

      if (trimmed && meta?.sessionId) {
        const uncertain = Boolean(questions?.some((q) => q.needsReview));
        sttContextRef.current.push(lane, trimmed, {
          trusted: true,
          // Keep uncertain meeting text out of rolling context so a bad
          // recognition cannot reinforce itself on the next segment.
          uncertain: who === "them" ? uncertain : false,
        });
      }

      if (who === "them" && questions?.length) {
        const review = questions.filter((q) => q.needsReview).length;
        setMicStatus(
          `${questions.length} question${questions.length === 1 ? "" : "s"} found` +
            (review ? ` (${review} may need a quick check)` : "") +
            " — tap to answer or edit.",
        );
      } else {
        setMicStatus(null);
      }
    },
    [],
  );

  const runAnalysis = async (
    prompt: string,
    imageBase64: string | null,
    options?: {
      forceArchitecture?: boolean;
      architectureDetail?: ArchitectureDetail;
      /** When set, do not also append a duplicate user bubble for the prompt. */
      skipUserBubble?: boolean;
      /** Ctrl+Enter Ask AI: left bubble shows Asking AI…; prompt stays hidden. */
      askQuiet?: boolean;
    },
  ) => {
    if (sendingRef.current) return;

    const trimmed = prompt.trim();
    const hasScreenshot = Boolean(imageBase64);
    const askQuiet = Boolean(options?.askQuiet);

    if (!trimmed && !hasScreenshot && !options?.forceArchitecture) {
      resetView();
      return;
    }

    // Always send recent thread history so architecture follow-ups
    // ("What about scalability?") can reference the prior design.
    // askQuiet only affects UI bubbles / prompt packaging.
    const history = messagesRef.current
      .filter((m) => m.id !== "welcome")
      .map(toHistoryEntry);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => {
      const next = [...prev];
      if (
        !askQuiet &&
        !options?.skipUserBubble &&
        (trimmed || hasScreenshot)
      ) {
        next.push({
          id: crypto.randomUUID(),
          role: "user",
          speaker: "me",
          content: trimmed || "Analyze this screen capture.",
          imageBase64: imageBase64 ?? undefined,
        });
      }
      next.push({
        id: assistantId,
        role: "assistant",
        speaker: "assistant",
        content: askQuiet ? "Asking AI…" : "",
        streaming: true,
      });
      return next;
    });
    setInput("");
    setPendingScreenshot(null);
    setSending(true);
    setMicStatus(null);

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

  const askAudienceQuestion = (
    question: ExtractedQuestion,
    editedText?: string,
  ) => {
    const decision = decideAskAudienceQuestion({
      question,
      editedText,
      alreadyAnsweredIds: answeredQuestionIds,
      submitting: sendingRef.current,
      messages: messagesRef.current,
    });

    if (decision.action === "require_review") {
      setEditingQuestionId(question.questionId);
      setEditingQuestionText(question.displayQuestion);
      setMicStatus("This question may be uncertain — edit it, then send.");
      return;
    }
    if (decision.action === "reject_duplicate" || decision.action === "reject_empty") {
      return;
    }

    setAnsweredQuestionIds((prev) =>
      prev.includes(decision.questionId)
        ? prev
        : [...prev, decision.questionId],
    );
    setEditingQuestionId(null);
    setEditingQuestionText("");

    const askBubble: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      speaker: "me",
      content: decision.questionText,
    };
    setMessages((prev) => {
      const next = [...prev, askBubble];
      messagesRef.current = next;
      return next;
    });

    void runAnalysis(decision.prompt, null, { skipUserBubble: true });
  };

  const updateQuestionDisplay = (
    messageId: string,
    questionId: string,
    displayQuestion: string,
  ) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.questions) return m;
        return {
          ...m,
          questions: m.questions.map((q) =>
            q.questionId === questionId
              ? {
                  ...q,
                  displayQuestion,
                  needsReview: false,
                }
              : q,
          ),
        };
      }),
    );
  };

  const askAboutConversation = (extraPrompt?: string) => {
    if (sendingRef.current) return;
    const note = extraPrompt?.trim();
    const selection = selectAskAiTarget({
      messages: messagesRef.current.map((m) => ({
        id: m.id,
        speaker: m.speaker,
        content: m.content,
        streaming: m.streaming,
      })),
      note,
    });
    if (
      selection.mode === "empty" &&
      !note &&
      !pendingRef.current
    ) {
      resetView();
      return;
    }
    const prompt = buildPromptFromSelection(selection);
    const started = performance.now();
    logAskAiDiagnostics(selection, {
      architectureMode: looksLikeArchitecture(prompt),
      model:
        (import.meta.env.VITE_GROQ_MODEL as string | undefined)?.trim() ||
        "openai/gpt-oss-20b",
    });
    void runAnalysis(prompt, pendingRef.current, {
      skipUserBubble: true,
      askQuiet: true,
    }).finally(() => {
      if (import.meta.env.DEV) {
        logAskAiDiagnostics(selection, {
          architectureMode: looksLikeArchitecture(prompt),
          model:
            (import.meta.env.VITE_GROQ_MODEL as string | undefined)?.trim() ||
            "openai/gpt-oss-20b",
          latencyMs: Math.round(performance.now() - started),
        });
      }
    });
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

  /** Microphone → You (right). Meeting loopback → Audience (left) + question chips. */
  const onAudioTranscript = useCallback(
    async (
      text: string,
      source: "microphone" | "meeting",
      meta: {
        originalText: string;
        sessionId: string;
        startedAtMs: number;
        endedAtMs: number;
        utteranceId: string;
        isPartial: boolean;
      },
    ) => {
      const who: "them" | "me" = source === "meeting" ? "them" : "me";
      const trimmed = text.trim();
      if (!trimmed) return;

      if (
        meta.isPartial &&
        finalizedUtterancesRef.current.has(meta.utteranceId)
      ) {
        return;
      }

      // Mic lane: drop acoustic bleed from speakers (partials + finals).
      if (who === "me" && dropMicIfBleed(trimmed, meta.utteranceId)) {
        return;
      }

      // Meeting lane: keep finals for bleed history; always scrub matching mic bubbles.
      if (who === "them") {
        if (!meta.isPartial) {
          recentAudienceRef.current = [
            trimmed,
            ...recentAudienceRef.current,
          ].slice(0, 12);
        }
        const micLive = liveUtteranceRef.current.microphone;
        if (micLive) {
          const micMsg = messagesRef.current.find(
            (m) => m.id === micLive.messageId,
          );
          if (
            micMsg?.content &&
            isMicBleedFromAudience(micMsg.content, [
              trimmed,
              ...recentAudienceRef.current,
            ])
          ) {
            dropMicIfBleed(micMsg.content, micLive.utteranceId);
          }
        }
      }

      const live = liveUtteranceRef.current[source];
      if (live && live.utteranceId === meta.utteranceId) {
        setMessages((prev) => {
          const next = prev.map((m) => {
            if (m.id !== live.messageId) return m;
            const questions =
              !meta.isPartial && who === "them"
                ? extractAudienceQuestions(trimmed, {
                    sourceTranscriptId: m.id,
                    recentContext: prev
                      .filter((x) => x.id !== "welcome" && x.content.trim())
                      .slice(-6)
                      .map((x) => x.content),
                  })
                : m.questions;
            return {
              ...m,
              content: trimmed,
              originalContent: meta.originalText?.trim() || m.originalContent,
              endedAtMs: meta.endedAtMs,
              streaming: meta.isPartial,
              questions:
                !meta.isPartial && questions?.length ? questions : undefined,
            };
          });
          messagesRef.current = next;
          return next;
        });

        if (!meta.isPartial) {
          finalizedUtterancesRef.current.add(meta.utteranceId);
          if (finalizedUtterancesRef.current.size > 80) {
            finalizedUtterancesRef.current.clear();
          }
          const finalized: ChatMessage = {
            id: live.messageId,
            role: "user",
            speaker: who,
            content: trimmed,
            originalContent: meta.originalText?.trim() || undefined,
            audioSource: source,
            captureSessionId: meta.sessionId,
            startedAtMs: meta.startedAtMs,
            endedAtMs: meta.endedAtMs,
          };
          lastSegmentRef.current[source] = finalized;
          sttContextRef.current.push(source, trimmed, {
            trusted: true,
            uncertain: false,
          });
          const recentBucket =
            source === "microphone" ? recentMicTextsRef : recentMeetingTextsRef;
          recentBucket.current = [trimmed, ...recentBucket.current].slice(0, 8);
          liveUtteranceRef.current[source] = undefined;

          if (who === "them") {
            const msg = messagesRef.current.find((m) => m.id === live.messageId);
            const qCount = msg?.questions?.length ?? 0;
            if (qCount) {
              const review =
                msg?.questions?.filter((q) => q.needsReview).length ?? 0;
              setMicStatus(
                `${qCount} question${qCount === 1 ? "" : "s"} found` +
                  (review ? ` (${review} may need a quick check)` : "") +
                  " — tap to answer or edit.",
              );
            } else {
              setMicStatus(null);
            }
          }
        }
        return;
      }

      // New utterance — create a streaming bubble for partials, or a normal one for finals.
      if (meta.isPartial) {
        const msgId = crypto.randomUUID();
        liveUtteranceRef.current[source] = {
          messageId: msgId,
          utteranceId: meta.utteranceId,
        };
        const msg: ChatMessage = {
          id: msgId,
          role: "user",
          speaker: who,
          content: trimmed,
          originalContent: meta.originalText?.trim() || undefined,
          audioSource: source,
          captureSessionId: meta.sessionId,
          startedAtMs: meta.startedAtMs,
          endedAtMs: meta.endedAtMs,
          streaming: true,
        };
        setMessages((prev) => {
          const next = [...prev, msg];
          messagesRef.current = next;
          return next;
        });
        return;
      }

      finalizedUtterancesRef.current.add(meta.utteranceId);
      if (finalizedUtterancesRef.current.size > 80) {
        finalizedUtterancesRef.current.clear();
      }

      const recentBucket =
        source === "microphone" ? recentMicTextsRef : recentMeetingTextsRef;
      recentBucket.current = [trimmed, ...recentBucket.current].slice(0, 8);

      if (source === "meeting") {
        appendSpeakerMessage(trimmed, "them", null, {
          originalText: meta.originalText,
          sessionId: meta.sessionId,
          startedAtMs: meta.startedAtMs,
          endedAtMs: meta.endedAtMs,
        });
        return;
      }
      appendSpeakerMessage(trimmed, "me", null, {
        originalText: meta.originalText,
        sessionId: meta.sessionId,
        startedAtMs: meta.startedAtMs,
        endedAtMs: meta.endedAtMs,
      });
    },
    [appendSpeakerMessage, dropMicIfBleed],
  );

  const {
    listening,
    busy: micBusy,
    toggle: toggleMic,
    sources: audioSources,
    micMuted,
  } = useMeetingCapture({
    transcribe: transcribeAudioBlob,
    getRecentTranscript: (source) =>
      sttContextRef.current.getPromptContext(source),
    getRecentSameSourceTexts: (source) =>
      source === "microphone"
        ? recentMicTextsRef.current
        : recentMeetingTextsRef.current,
    onSessionStart: (sessionId) => {
      sttContextRef.current.reset(sessionId);
      lastSegmentRef.current = {};
      liveUtteranceRef.current = {};
      finalizedUtterancesRef.current.clear();
      recentMicTextsRef.current = [];
      recentMeetingTextsRef.current = [];
    },
    onSessionEnd: () => {
      sttContextRef.current.clear();
      lastSegmentRef.current = {};
      liveUtteranceRef.current = {};
      finalizedUtterancesRef.current.clear();
      recentMicTextsRef.current = [];
      recentMeetingTextsRef.current = [];
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        );
        messagesRef.current = next;
        return next;
      });
    },
    onSegmentDiscarded: ({ source, utteranceId, isPartial }) => {
      const live = liveUtteranceRef.current[source];
      if (!live || live.utteranceId !== utteranceId) return;
      // Empty/hallucinated interim must not lock out the final for this utterance.
      if (isPartial) {
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== live.messageId);
          messagesRef.current = next;
          return next;
        });
        liveUtteranceRef.current[source] = undefined;
        return;
      }
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== live.messageId);
        messagesRef.current = next;
        return next;
      });
      liveUtteranceRef.current[source] = undefined;
      finalizedUtterancesRef.current.add(utteranceId);
    },
    onTranscript: onAudioTranscript,
    onError: (message) => setMicStatus(message),
    onStatus: (message) => setMicStatus(message),
  });

  const {
    listening: voiceListening,
    busy: voiceBusy,
    toggle: toggleComposerVoice,
  } = useComposerVoiceInput({
    getBaselineText: () => inputRef.current,
    onDraftChange: (text) => {
      setInput(text);
      setMicStatus(null);
    },
    onError: (message) => setMicStatus(message),
    onStatus: (message) => setMicStatus(message),
  });

  useGlobalShortcuts({
    onScreenshotAnalyze: (imageBase64) => {
      void runAnalysis("", imageBase64);
    },
    onScreenshotError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          speaker: "assistant",
          content:
            "Could not capture the screen. Check display permissions and try again.",
        },
      ]);
    },
    onAnalyzeChat: () => {
      // Ctrl/⌘+Enter — ask AI about the conversation (+ composer text).
      askAboutConversation(inputRef.current);
    },
    onToggleRecord: () => {
      // Ctrl/⌘+G — same as Record: mic (You) + meeting audio (Audience).
      if (voiceListening || voiceBusy) return;
      if (sending && !listening) return;
      toggleMic();
    },
    onScrollChatUp: () => {
      listRef.current?.scrollBy({
        top: -CHAT_SCROLL_STEP_PX,
        behavior: "auto",
      });
    },
    onScrollChatDown: () => {
      listRef.current?.scrollBy({
        top: CHAT_SCROLL_STEP_PX,
        behavior: "auto",
      });
    },
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // Enter / Send: optional typed note on your side (right).
    if (!input.trim() && !pendingScreenshot) return;
    appendSpeakerMessage(input, "me", pendingScreenshot);
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

        <div className="chat-messages-shell">
          <div className="chat-messages chat-messages--thread" ref={listRef}>
            {messages.length === 0 && !pendingScreenshot && (
              <p className="chat-welcome" role="status">
                Session ready. Capture what’s said, jot notes as you go, and ask
                AI when you need a clear take.
              </p>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`bubble bubble--${message.speaker}`}
              >
                <span className="bubble__role">
                  {message.speaker === "them"
                    ? "Audience (speaker)"
                    : message.speaker === "me"
                      ? "You (mic)"
                      : "AI"}
                </span>
                {message.imageBase64 && (
                  <img
                    className="bubble__shot"
                    src={screenshotDataUrl(message.imageBase64)}
                    alt="Captured screen"
                  />
                )}
                {message.speaker === "assistant" ? (
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
                  <p>
                    {message.content}
                    {message.streaming ? (
                      <span className="stream-cursor" aria-hidden="true" />
                    ) : null}
                    {!message.streaming &&
                      message.originalContent &&
                      message.originalContent !== message.content && (
                        <span className="bubble__original-hint" title={message.originalContent}>
                          {" "}
                          · STT preserved
                        </span>
                      )}
                  </p>
                )}
                {message.speaker === "them" &&
                  message.questions &&
                  message.questions.length > 0 && (
                    <div
                      className="audience-questions"
                      role="group"
                      aria-label="Audience questions"
                    >
                      <span className="audience-questions__label">
                        Questions from this clip — tap to answer
                      </span>
                      <div className="audience-questions__list">
                        {message.questions.map((q) => {
                          const answered = answeredQuestionIds.includes(
                            q.questionId,
                          );
                          const editing = editingQuestionId === q.questionId;
                          if (editing) {
                            return (
                              <div
                                key={q.questionId}
                                className="audience-questions__edit"
                              >
                                <input
                                  value={editingQuestionText}
                                  onChange={(e) =>
                                    setEditingQuestionText(e.target.value)
                                  }
                                  aria-label="Edit question before sending"
                                />
                                <button
                                  type="button"
                                  className="audience-questions__btn"
                                  disabled={sending || !editingQuestionText.trim()}
                                  onClick={() => {
                                    updateQuestionDisplay(
                                      message.id,
                                      q.questionId,
                                      editingQuestionText.trim(),
                                    );
                                    askAudienceQuestion(
                                      {
                                        ...q,
                                        displayQuestion:
                                          editingQuestionText.trim(),
                                        needsReview: false,
                                      },
                                      editingQuestionText.trim(),
                                    );
                                  }}
                                >
                                  Send
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => {
                                    setEditingQuestionId(null);
                                    setEditingQuestionText("");
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            );
                          }
                          return (
                            <span
                              key={q.questionId}
                              className="audience-questions__chip-wrap"
                            >
                              <button
                                type="button"
                                className={`audience-questions__btn${q.needsReview ? " audience-questions__btn--review" : ""}`}
                                disabled={sending || answered}
                                onClick={() => askAudienceQuestion(q)}
                                title={
                                  q.needsReview
                                    ? `May need review. Original: ${q.originalQuestion}`
                                    : `Send to AI. Original: ${q.originalQuestion}`
                                }
                              >
                                {q.needsReview ? "Review · " : ""}
                                {q.displayQuestion}
                              </button>
                              <button
                                type="button"
                                className="audience-questions__edit-btn"
                                disabled={sending || answered}
                                onClick={() => {
                                  setEditingQuestionId(q.questionId);
                                  setEditingQuestionText(q.displayQuestion);
                                }}
                                title="Edit question before sending"
                                aria-label="Edit question"
                              >
                                Edit
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </article>
            ))}
            {pendingScreenshot && (
              <article className="bubble bubble--me">
                <span className="bubble__role">Pending capture</span>
                <img
                  className="bubble__shot"
                  src={screenshotDataUrl(pendingScreenshot)}
                  alt="Pending screenshot"
                />
                <p>Ready for {modLabel}+Enter analysis</p>
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

        {openQuestions.length > 0 && (
          <div
            className="open-questions"
            role="region"
            aria-label="Open audience questions"
          >
            <span className="open-questions__label">
              Open questions — click one for an AI answer
            </span>
            <div className="open-questions__list">
              {openQuestions.map((q) => (
                <button
                  key={q.questionId}
                  type="button"
                  className={`audience-questions__btn${q.needsReview ? " audience-questions__btn--review" : ""}`}
                  disabled={sending}
                  onClick={() => askAudienceQuestion(q)}
                  title={
                    q.needsReview
                      ? `May need review. Original: ${q.originalQuestion}`
                      : q.originalQuestion
                  }
                >
                  {q.needsReview ? "Review · " : ""}
                  {q.displayQuestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {(micStatus || listening || micBusy || voiceListening || voiceBusy) && (
          <p className="mic-status" role="status">
            {voiceListening
              ? "Voice input listening… tap the mic icon to stop"
              : voiceBusy
                ? "Finishing speech-to-text…"
                : listening
                  ? [
                      "Recording…",
                      micMuted
                        ? "mic quiet/muted"
                        : audioSources.mic
                          ? "mic → You (right)"
                          : "mic unavailable",
                      audioSources.meeting
                        ? "meeting → Audience (left)"
                        : "meeting audio unavailable",
                      "STT only on detected speech",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : micBusy
                    ? "Transcribing speech segment…"
                    : micStatus}
          </p>
        )}

        <form className="chat-composer chat-composer--voice" onSubmit={onSubmit}>
          <button
            type="button"
            className={`mic-button${listening ? " mic-button--live" : ""}`}
            onClick={() => toggleMic()}
            disabled={(sending && !listening) || voiceListening || voiceBusy}
            title={
              listening
                ? `Stop meeting recording (${modLabel}+G)`
                : `Record mic (You) + meeting/system audio (Audience) · ${modLabel}+G`
            }
            aria-label={
              listening ? "Stop meeting recording" : "Start meeting recording"
            }
            aria-pressed={listening}
          >
            {listening ? "Stop" : "Record"}
          </button>
          <div
            className={`composer-input-wrap${voiceListening ? " composer-input-wrap--live" : ""}`}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(event) => {
                // Local fallback when OS global Ctrl/⌘+Enter failed to register
                // (overlapping tauri:dev instances / hotkey already taken).
                if (
                  (event.ctrlKey || event.metaKey) &&
                  !event.altKey &&
                  !event.shiftKey &&
                  event.key === "Enter"
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  askAboutConversation(input);
                }
              }}
              placeholder={
                voiceListening
                  ? "Listening… speak, then tap the mic to finish"
                  : voiceBusy
                    ? "Finishing speech-to-text…"
                    : listening
                      ? "Optional note (right)… Enter adds · tap question chips to answer"
                      : `Type or tap the mic… Enter adds · ${modLabel}+Enter asks AI`
              }
              aria-label="Message"
              disabled={voiceBusy}
              readOnly={voiceListening}
            />
            <button
              type="button"
              className={`composer-input-mic${voiceListening ? " composer-input-mic--live" : ""}${voiceBusy ? " composer-input-mic--busy" : ""}`}
              onClick={() => toggleComposerVoice()}
              disabled={sending || voiceBusy || (listening && !voiceListening)}
              title={
                listening && !voiceListening
                  ? "Stop meeting Record first to use composer voice input"
                  : voiceListening
                    ? "Stop voice input and convert to text"
                    : "Voice input — tap, speak, tap again"
              }
              aria-label={
                voiceListening
                  ? "Stop voice input"
                  : voiceBusy
                    ? "Finishing speech-to-text"
                    : "Start voice input"
              }
              aria-pressed={voiceListening}
            >
              <ComposerMicIcon
                listening={voiceListening}
                busy={voiceBusy}
              />
            </button>
          </div>
          <button
            type="submit"
            className="btn btn-ghost"
            disabled={
              sending ||
              voiceListening ||
              voiceBusy ||
              (!input.trim() && !pendingScreenshot)
            }
            title="Add typed note on your side"
          >
            Add
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={sending || voiceListening || voiceBusy}
            title={`${modLabel}+Enter — ask AI about the conversation`}
            onClick={() => askAboutConversation(input)}
          >
            Ask AI
          </button>
        </form>
      </aside>
    </div>
  );
}
