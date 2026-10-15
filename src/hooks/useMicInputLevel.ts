import { useEffect, useState } from "react";
import {
  classifyMicLevel,
  normalizeMicRms,
  rmsFromTimeDomain,
  type MicLevelBand,
} from "../lib/micLevel";

type MicInputLevel = {
  level: number;
  band: MicLevelBand;
};

const IDLE: MicInputLevel = { level: 0, band: "silent" };

/**
 * Live 0–1 input level from a mic MediaStream (AnalyserNode).
 * Stops cleanly when the stream is cleared or the component unmounts.
 */
export function useMicInputLevel(stream: MediaStream | null): MicInputLevel {
  const [state, setState] = useState<MicInputLevel>(IDLE);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setState(IDLE);
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      setState(IDLE);
      return;
    }

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let raf = 0;
    let smoothed = 0;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      analyser.getFloatTimeDomainData(samples);
      const instant = normalizeMicRms(rmsFromTimeDomain(samples));
      smoothed = smoothed * 0.65 + instant * 0.35;
      const level = smoothed < 0.02 ? 0 : smoothed;
      setState({ level, band: classifyMicLevel(level) });
      raf = requestAnimationFrame(tick);
    };

    void ctx.resume().then(() => {
      if (alive) raf = requestAnimationFrame(tick);
    });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
      void ctx.close();
      setState(IDLE);
    };
  }, [stream]);

  return state;
}
