import { useCallback, useEffect, useRef, useState } from "react";
import { isMicHardwareMuted } from "../lib/audioActivity";

export type AudioSource = "mic" | "speaker";

type Options = {
  onTranscript: (text: string, source: AudioSource) => void | Promise<void>;
  onError?: (message: string) => void;
  /** Hint shown just before the system-audio share picker. */
  onStatus?: (message: string) => void;
  /** Called with a Blob when a slice is ready — parent runs STT. */
  transcribe: (blob: Blob) => Promise<string>;
  /**
   * Meeting mode: keep streams open and auto-slice every `sliceMs`
   * so the conversation streams into chat as it happens.
   */
  continuous?: boolean;
  /** Length of each auto-transcribed slice (meeting mode). Default 12s. */
  sliceMs?: number;
};

type Channel = {
  media: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  sliceTimer: number | null;
  mutePoll: number | null;
};

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

function emptyChannel(): Channel {
  return {
    media: null,
    recorder: null,
    chunks: [],
    sliceTimer: null,
    mutePoll: null,
  };
}

/**
 * Dual-source meeting recorder:
 * - Microphone input → "mic" (you)
 * - Speaker / system audio (display capture with audio) → "speaker" (audience)
 */
export function useMicRecorder({
  onTranscript,
  onError,
  onStatus,
  transcribe,
  continuous = false,
  sliceMs = 12_000,
}: Options) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<{ mic: boolean; speaker: boolean }>({
    mic: false,
    speaker: false,
  });
  const [micMuted, setMicMuted] = useState(false);
  const listeningRef = useRef(false);
  const mimeRef = useRef<string | undefined>(undefined);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const onStatusRef = useRef(onStatus);
  const transcribeRef = useRef(transcribe);
  const continuousRef = useRef(continuous);
  const sliceMsRef = useRef(sliceMs);
  const transcribeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const channelsRef = useRef<{ mic: Channel; speaker: Channel }>({
    mic: emptyChannel(),
    speaker: emptyChannel(),
  });
  const beginSliceRef = useRef<(source: AudioSource) => void>(() => {});

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);
  useEffect(() => {
    transcribeRef.current = transcribe;
  }, [transcribe]);
  useEffect(() => {
    continuousRef.current = continuous;
  }, [continuous]);
  useEffect(() => {
    sliceMsRef.current = sliceMs;
  }, [sliceMs]);

  const clearMutePoll = useCallback((source: AudioSource) => {
    const ch = channelsRef.current[source];
    if (ch.mutePoll != null) {
      window.clearInterval(ch.mutePoll);
      ch.mutePoll = null;
    }
  }, []);

  const clearSliceTimer = useCallback((source: AudioSource) => {
    const ch = channelsRef.current[source];
    if (ch.sliceTimer != null) {
      window.clearTimeout(ch.sliceTimer);
      ch.sliceTimer = null;
    }
  }, []);

  const stopChannelTracks = useCallback(
    (source: AudioSource) => {
      const ch = channelsRef.current[source];
      clearMutePoll(source);
      ch.media?.getTracks().forEach((t) => t.stop());
      ch.media = null;
      ch.recorder = null;
      ch.chunks = [];
      if (source === "mic") setMicMuted(false);
    },
    [clearMutePoll],
  );

  const stopAll = useCallback(() => {
    (["mic", "speaker"] as const).forEach((source) => {
      clearSliceTimer(source);
      try {
        const rec = channelsRef.current[source].recorder;
        if (rec && rec.state === "recording") rec.stop();
      } catch {
        /* ignore */
      }
      stopChannelTracks(source);
    });
    listeningRef.current = false;
    setListening(false);
    setSources({ mic: false, speaker: false });
  }, [clearSliceTimer, stopChannelTracks]);

  useEffect(
    () => () => {
      listeningRef.current = false;
      (["mic", "speaker"] as const).forEach((source) => {
        clearSliceTimer(source);
        try {
          const rec = channelsRef.current[source].recorder;
          if (rec && rec.state === "recording") rec.stop();
        } catch {
          /* ignore */
        }
        stopChannelTracks(source);
      });
    },
    [clearSliceTimer, stopChannelTracks],
  );

  const enqueueTranscript = useCallback((blob: Blob, source: AudioSource) => {
    if (blob.size < 400) return;
    // Only skip mic when the OS/hotkey mute flag is set. Never gate on
    // analyser peaks — those often stay 0 in WebView and blocked all STT.
    if (source === "mic" && isMicHardwareMuted(channelsRef.current.mic.media)) {
      return;
    }
    setBusy(true);
    transcribeQueueRef.current = transcribeQueueRef.current
      .then(async () => {
        try {
          const text = await transcribeRef.current(blob);
          if (text.trim()) {
            await onTranscriptRef.current(text.trim(), source);
          }
        } catch (err) {
          const message =
            err instanceof Error && err.message
              ? err.message
              : "Could not transcribe audio.";
          onErrorRef.current?.(message);
        }
      })
      .finally(() => {
        void transcribeQueueRef.current.then(() => setBusy(false));
      });
  }, []);

  const beginSlice = useCallback(
    (source: AudioSource) => {
      const ch = channelsRef.current[source];
      const stream = ch.media;
      if (!stream || !listeningRef.current) return;
      if (stream.getAudioTracks().length === 0) return;

      ch.chunks = [];
      if (source === "mic") {
        clearMutePoll("mic");
        setMicMuted(isMicHardwareMuted(stream));
        ch.mutePoll = window.setInterval(() => {
          setMicMuted(isMicHardwareMuted(channelsRef.current.mic.media));
        }, 400);
      }

      const mime = mimeRef.current;
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      ch.recorder = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) ch.chunks.push(event.data);
      };

      recorder.onerror = () => {
        onErrorRef.current?.(
          source === "mic"
            ? "Microphone recording failed."
            : "Speaker audio recording failed.",
        );
        clearSliceTimer(source);
        stopChannelTracks(source);
        setSources((prev) => ({ ...prev, [source]: false }));
        const other = source === "mic" ? "speaker" : "mic";
        if (!channelsRef.current[other].media) {
          listeningRef.current = false;
          setListening(false);
        }
      };

      recorder.onstop = () => {
        const chunks = ch.chunks;
        const type = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks, { type });
        ch.chunks = [];

        const keepGoing =
          listeningRef.current &&
          continuousRef.current &&
          Boolean(ch.media?.active);
        if (keepGoing) {
          beginSliceRef.current(source);
        } else {
          clearSliceTimer(source);
          clearMutePoll(source);
          if (!listeningRef.current) {
            stopChannelTracks(source);
          }
        }

        enqueueTranscript(blob, source);
      };

      recorder.start(250);

      if (continuousRef.current) {
        clearSliceTimer(source);
        ch.sliceTimer = window.setTimeout(() => {
          if (ch.recorder?.state === "recording") {
            ch.recorder.stop();
          }
        }, sliceMsRef.current);
      }
    },
    [clearMutePoll, clearSliceTimer, enqueueTranscript, stopChannelTracks],
  );

  useEffect(() => {
    beginSliceRef.current = beginSlice;
  }, [beginSlice]);

  const attachMuteWatchers = useCallback((stream: MediaStream) => {
    const sync = () => setMicMuted(isMicHardwareMuted(stream));
    sync();
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("mute", sync);
      track.addEventListener("unmute", sync);
      track.addEventListener("ended", sync);
    });
  }, []);

  const start = useCallback(async () => {
    if (listeningRef.current || busy) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      onErrorRef.current?.(
        "Audio capture is not available in this environment.",
      );
      return;
    }

    mimeRef.current = pickMimeType();
    let micOk = false;
    let speakerOk = false;

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      channelsRef.current.mic.media = micStream;
      attachMuteWatchers(micStream);
      micOk = true;
    } catch {
      onErrorRef.current?.(
        "Microphone permission denied. Allow mic access and try again.",
      );
      return;
    }

    if (navigator.mediaDevices.getDisplayMedia) {
      try {
        onStatusRef.current?.(
          "Next: pick Entire screen (or the meeting window) and turn on Share system audio. We only use the sound — not the video.",
        );
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            systemAudio: "include",
          } as MediaTrackConstraints,
        });
        displayStream.getVideoTracks().forEach((t) => {
          t.stop();
          displayStream.removeTrack(t);
        });
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
          displayStream.getTracks().forEach((t) => t.stop());
          onErrorRef.current?.(
            "No speaker audio. Choose Entire screen and enable “Share system audio”, then try Record again.",
          );
        } else {
          audioTracks.forEach((track) => {
            track.onended = () => {
              clearSliceTimer("speaker");
              stopChannelTracks("speaker");
              setSources((prev) => ({ ...prev, speaker: false }));
              if (!channelsRef.current.mic.media) {
                listeningRef.current = false;
                setListening(false);
              } else {
                onErrorRef.current?.(
                  "Speaker share ended. Mic is still recording you on the right.",
                );
              }
            };
          });
          channelsRef.current.speaker.media = displayStream;
          speakerOk = true;
        }
      } catch {
        onErrorRef.current?.(
          "Speaker audio not shared. Mic will still capture you on the right. Re-record and allow system/speaker audio for the audience on the left.",
        );
      }
    } else {
      onErrorRef.current?.(
        "This environment cannot capture speaker output. Mic will still capture you on the right.",
      );
    }

    if (!micOk && !speakerOk) {
      stopAll();
      return;
    }

    listeningRef.current = true;
    setListening(true);
    setSources({ mic: micOk, speaker: speakerOk });
    if (micOk) beginSlice("mic");
    if (speakerOk) beginSlice("speaker");
  }, [
    attachMuteWatchers,
    beginSlice,
    busy,
    clearSliceTimer,
    stopAll,
    stopChannelTracks,
  ]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    (["mic", "speaker"] as const).forEach((source) => {
      clearSliceTimer(source);
      clearMutePoll(source);
      const rec = channelsRef.current[source].recorder;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          stopChannelTracks(source);
        }
      } else {
        stopChannelTracks(source);
      }
    });
    window.setTimeout(() => {
      if (!listeningRef.current) {
        stopChannelTracks("mic");
        stopChannelTracks("speaker");
        setListening(false);
        setSources({ mic: false, speaker: false });
      }
    }, 50);
  }, [clearMutePoll, clearSliceTimer, stopChannelTracks]);

  const toggle = useCallback(() => {
    if (busy && !listeningRef.current) return;
    if (listeningRef.current) stop();
    else void start();
  }, [busy, start, stop]);

  return { listening, busy, toggle, start, stop, sources, micMuted };
}
