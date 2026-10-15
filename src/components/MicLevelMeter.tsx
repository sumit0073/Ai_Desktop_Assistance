import type { MicLevelBand } from "../lib/micLevel";

type Props = {
  level: number;
  band: MicLevelBand;
  label?: string;
};

/** Meet-style horizontal mic strength meter (yellow soft → green good → red hot). */
export function MicLevelMeter({ level, band, label }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);

  return (
    <div
      className={`mic-level-meter mic-level-meter--${band}`}
      role="meter"
      aria-label={label ?? "Microphone input level"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={
        band === "silent"
          ? "Silent"
          : band === "quiet"
            ? "Quiet"
            : band === "good"
              ? "Good"
              : "Too loud"
      }
    >
      <span className="mic-level-meter__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
          <path
            d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <path
            d="M19 11a7 7 0 0 1-14 0M12 18v3"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <div className="mic-level-meter__track">
        <div
          className="mic-level-meter__fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
