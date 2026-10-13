import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudioBlob } from "../lib/transcribeAudio";

type Options = {
  /** Composer text at the moment listening starts (kept as a prefix). */
  getBaselineText: () => string;
  /** Update the composer while listening / on final (full field value). */
  onDraftChange: (text: string) => void;
  onError?: (message: string) => void;
  onStatus?: (message: string) => void;
  /** Soft cap so a forgotten mic does not run forever. */
  maxMs?: number;
  /** How often to refresh live STT into the box while speaking. */
  liveIntervalMs?: number;
};

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  // WebView2's SpeechRecognition talks to Google's cloud service and often
  // fails with `network` inside Tauri — skip it in the desktop shell.
  if (isTauriRuntime()) return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function composeDraft(baseline: string, spoken: string): string {
  const b = baseline.trim();
  const s = spoken.trim();
  if (!b) return s;
  if (!s) return b;
  return `${b} ${s}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Reveal new words one-by-one when a longer transcript arrives so the
 * composer feels closer to live captions (Whisper only returns whole chunks).
 */
async function revealSpokenGrowth(
  previous: string,
  next: string,
  onWord: (spoken: string) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const prevWords = previous.trim() ? previous.trim().split(/\s+/) : [];
  const nextWords = next.trim() ? next.trim().split(/\s+/) : [];
  if (!nextWords.length) return;

  let shared = 0;
  while (
    shared < prevWords.length &&
    shared < nextWords.length &&
    prevWords[shared] === nextWords[shared]
  ) {
    shared += 1;
  }

  // Whisper revised earlier words — jump to the new text.
  if (shared < prevWords.length) {
    if (!isCancelled()) onWord(nextWords.join(" "));
    return;
  }

  for (let i = Math.max(shared, 1); i <= nextWords.length; i++) {
    if (isCancelled()) return;
    onWord(nextWords.slice(0, i).join(" "));
    if (i < nextWords.length) await sleep(45);
  }
}

/**
 * Composer voice input.
 * - Browser (non-Tauri): Web Speech API when available (true interim words).
 * - Tauri desktop: Groq Whisper via proxy with live chunk updates + word reveal
 *   (Web Speech's cloud backend usually fails with "network" in WebView2).
 */
export function useComposerVoiceInput({
  getBaselineText,
  onDraftChange,
  onError,
  onStatus,
  maxMs = 60_000,
  /** Live STT while speaking; set 0 to only transcribe on stop (more reliable). */
  liveIntervalMs = 0,
}: Options) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);

  const getBaselineRef = useRef(getBaselineText);
  const onDraftRef = useRef(onDraftChange);
  const onErrorRef = useRef(onError);
  const onStatusRef = useRef(onStatus);

  const baselineRef = useRef("");
  const finalSpokenRef = useRef("");
  const lastSpokenRef = useRef("");
  const listeningRef = useRef(false);
  const stoppingRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const maxTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const revealGenRef = useRef(0);

  const mediaRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const liveTimerRef = useRef<number | null>(null);
  const liveAbortRef = useRef<AbortController | null>(null);
  const liveInFlightRef = useRef(false);
  const whisperFallbackRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    getBaselineRef.current = getBaselineText;
  }, [getBaselineText]);
  useEffect(() => {
    onDraftRef.current = onDraftChange;
  }, [onDraftChange]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const clearMaxTimer = useCallback(() => {
    if (maxTimerRef.current != null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const clearLiveTimer = useCallback(() => {
    if (liveTimerRef.current != null) {
      window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
  }, []);

  const publishSpoken = useCallback((spoken: string) => {
    lastSpokenRef.current = spoken;
    onDraftRef.current(composeDraft(baselineRef.current, spoken));
  }, []);

  const publishSpokenRevealed = useCallback(
    async (spoken: string) => {
      const gen = ++revealGenRef.current;
      const previous = lastSpokenRef.current;
      await revealSpokenGrowth(
        previous,
        spoken,
        (partial) => {
          if (revealGenRef.current !== gen) return;
          publishSpoken(partial);
        },
        () =>
          revealGenRef.current !== gen ||
          !listeningRef.current ||
          stoppingRef.current,
      );
    },
    [publishSpoken],
  );

  const cleanupWhisper = useCallback(() => {
    clearLiveTimer();
    liveAbortRef.current?.abort();
    liveAbortRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    chunksRef.current = [];
  }, [clearLiveTimer]);

  const cleanupRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const fullCleanup = useCallback(() => {
    clearMaxTimer();
    revealGenRef.current += 1;
    cleanupRecognition();
    cleanupWhisper();
  }, [cleanupRecognition, cleanupWhisper, clearMaxTimer]);

  useEffect(() => () => fullCleanup(), [fullCleanup]);

  const endSession = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    setBusy(false);
    stoppingRef.current = false;
    intentionalStopRef.current = false;
    baselineRef.current = "";
    finalSpokenRef.current = "";
    lastSpokenRef.current = "";
    clearMaxTimer();
  }, [clearMaxTimer]);

  const stopWebSpeech = useCallback(() => {
    if (!listeningRef.current || stoppingRef.current) return;
    stoppingRef.current = true;
    intentionalStopRef.current = true;
    clearMaxTimer();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    publishSpoken(finalSpokenRef.current);
    endSession();
  }, [clearMaxTimer, endSession, publishSpoken]);

  const startWebSpeech = useCallback(() => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return false;

    try {
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang =
        (typeof navigator !== "undefined" && navigator.language) || "en-US";

      baselineRef.current = getBaselineRef.current().trim();
      finalSpokenRef.current = "";
      lastSpokenRef.current = "";
      intentionalStopRef.current = false;
      stoppingRef.current = false;

      recognition.onresult = (event) => {
        if (!listeningRef.current) return;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i]?.[0]?.transcript ?? "";
          if (!piece) continue;
          if (event.results[i]!.isFinal) {
            finalSpokenRef.current = `${finalSpokenRef.current} ${piece}`.trim();
          } else {
            interim += piece;
          }
        }
        const spoken = `${finalSpokenRef.current} ${interim}`.trim();
        if (spoken) publishSpoken(spoken);
      };

      recognition.onerror = (event) => {
        if (intentionalStopRef.current) return;
        const code = event.error;
        if (code === "no-speech" || code === "aborted") return;

        // Cloud speech failed — silently continue with Whisper (no scary toast).
        if (
          code === "network" ||
          code === "service-not-allowed" ||
          code === "not-allowed"
        ) {
          cleanupRecognition();
          listeningRef.current = false;
          setListening(false);
          void whisperFallbackRef.current();
          return;
        }

        onErrorRef.current?.("Voice input failed. Try again.");
        cleanupRecognition();
        endSession();
      };

      recognition.onend = () => {
        if (
          listeningRef.current &&
          !intentionalStopRef.current &&
          !stoppingRef.current
        ) {
          try {
            recognition.start();
            return;
          } catch {
            /* fall through */
          }
        }
        if (!intentionalStopRef.current && listeningRef.current) {
          endSession();
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      listeningRef.current = true;
      setListening(true);
      onStatusRef.current?.("Listening… words appear as you speak.");
      maxTimerRef.current = window.setTimeout(() => {
        stopWebSpeech();
      }, maxMs);
      return true;
    } catch {
      cleanupRecognition();
      return false;
    }
  }, [cleanupRecognition, endSession, maxMs, publishSpoken, stopWebSpeech]);

  const runLivePartial = useCallback(async () => {
    if (!listeningRef.current || stoppingRef.current || liveInFlightRef.current) {
      return;
    }
    const parts = chunksRef.current;
    if (!parts.length) return;
    const blob = new Blob(parts, { type: mimeRef.current });
    if (blob.size < 900) return;

    liveAbortRef.current?.abort();
    const ac = new AbortController();
    liveAbortRef.current = ac;
    liveInFlightRef.current = true;
    try {
      const result = await transcribeAudioBlob(blob, {
        interim: true,
        signal: ac.signal,
      });
      if (!listeningRef.current || ac.signal.aborted || stoppingRef.current) {
        return;
      }
      const spoken = result.text.trim();
      if (spoken) await publishSpokenRevealed(spoken);
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        ac.signal.aborted
      ) {
        return;
      }
    } finally {
      if (liveAbortRef.current === ac) liveAbortRef.current = null;
      liveInFlightRef.current = false;
    }
  }, [publishSpokenRevealed]);

  const finishWhisperRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    listeningRef.current = false;
    clearMaxTimer();
    clearLiveTimer();
    revealGenRef.current += 1;
    liveAbortRef.current?.abort();
    liveAbortRef.current = null;
    setListening(false);
    setBusy(true);
    onStatusRef.current?.("Converting speech to text…");

    const recorder = recorderRef.current;
    const mime = mimeRef.current;

    try {
      // Flush the current timeslice so the last words are in the blob.
      if (recorder && recorder.state === "recording") {
        try {
          recorder.requestData();
        } catch {
          /* older engines */
        }
      }

      const blob = await new Promise<Blob | null>((resolve) => {
        if (!recorder || recorder.state === "inactive") {
          resolve(
            chunksRef.current.length
              ? new Blob(chunksRef.current, { type: mime })
              : null,
          );
          return;
        }
        const finish = () => {
          const parts = chunksRef.current;
          chunksRef.current = [];
          resolve(parts.length ? new Blob(parts, { type: mime }) : null);
        };
        recorder.onstop = finish;
        try {
          recorder.stop();
        } catch {
          finish();
        }
      });

      mediaRef.current?.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
      recorderRef.current = null;

      if (!blob || blob.size < 256) {
        onErrorRef.current?.("No speech captured. Tap the mic and try again.");
        return;
      }

      const result = await transcribeAudioBlob(blob);
      if (!result.text.trim()) {
        onErrorRef.current?.(
          result.originalText?.trim()
            ? "That clip looked like silence filler and was ignored. Speak clearly, then tap the mic to stop."
            : "Could not hear clear speech. Try again a bit closer to the mic.",
        );
      } else {
        publishSpoken(result.text.trim());
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Speech-to-text failed.";
      onErrorRef.current?.(message);
    } finally {
      mediaRef.current?.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
      recorderRef.current = null;
      setBusy(false);
      setListening(false);
      listeningRef.current = false;
      stoppingRef.current = false;
      baselineRef.current = "";
      finalSpokenRef.current = "";
      lastSpokenRef.current = "";
    }
  }, [clearLiveTimer, clearMaxTimer, publishSpoken]);

  const startWhisperFallback = useCallback(async () => {
    if (listeningRef.current || stoppingRef.current) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      onErrorRef.current?.(
        "Voice input is not available in this environment.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaRef.current = stream;
      chunksRef.current = [];
      baselineRef.current = getBaselineRef.current().trim();
      finalSpokenRef.current = "";
      lastSpokenRef.current = "";
      const mime = pickMimeType();
      mimeRef.current = mime || "audio/webm";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start(250);
      listeningRef.current = true;
      stoppingRef.current = false;
      intentionalStopRef.current = false;
      setListening(true);
      setBusy(false);
      onStatusRef.current?.(
        "Listening… speak, then tap the mic icon again to convert to text.",
      );

      if (liveIntervalMs > 0) {
        liveTimerRef.current = window.setInterval(() => {
          void runLivePartial();
        }, liveIntervalMs);
      }

      maxTimerRef.current = window.setTimeout(() => {
        void finishWhisperRecording();
      }, maxMs);
    } catch (err) {
      cleanupWhisper();
      listeningRef.current = false;
      stoppingRef.current = false;
      setListening(false);
      setBusy(false);
      const detail =
        err instanceof Error && err.message
          ? err.message
          : "Microphone permission denied.";
      onErrorRef.current?.(
        /denied|permission|NotAllowed/i.test(detail)
          ? "Microphone permission denied. Allow mic access for System Bunny and try again."
          : `Could not open microphone: ${detail}`,
      );
    }
  }, [
    cleanupWhisper,
    finishWhisperRecording,
    liveIntervalMs,
    maxMs,
    runLivePartial,
  ]);

  useEffect(() => {
    whisperFallbackRef.current = startWhisperFallback;
  }, [startWhisperFallback]);

  const start = useCallback(async () => {
    if (listeningRef.current || busy || stoppingRef.current) return;
    // Desktop app: go straight to Whisper (reliable via your proxy).
    if (isTauriRuntime()) {
      await startWhisperFallback();
      return;
    }
    if (startWebSpeech()) return;
    await startWhisperFallback();
  }, [busy, startWebSpeech, startWhisperFallback]);

  const stop = useCallback(() => {
    if (!listeningRef.current || stoppingRef.current) return;
    if (recognitionRef.current) {
      stopWebSpeech();
      return;
    }
    void finishWhisperRecording();
  }, [finishWhisperRecording, stopWebSpeech]);

  const toggle = useCallback(() => {
    if (busy) return;
    if (listeningRef.current) stop();
    else void start();
  }, [busy, start, stop]);

  return { listening, busy, toggle, start, stop };
}
