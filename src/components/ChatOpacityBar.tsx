import {
  CHAT_OVERLAY_SLIDER_DEFAULT,
  CHAT_OVERLAY_SLIDER_MAX,
  CHAT_OVERLAY_SLIDER_MIN,
  sliderToOpacity,
} from "../lib/chatOverlayOpacity";

type Props = {
  value: number;
  onChange: (value: number) => void;
};

/** Topbar slider: left = glass (5%), right = solid (100%), middle = default. */
export function ChatOpacityBar({ value, onChange }: Props) {
  const opacityPct = Math.round(sliderToOpacity(value) * 100);

  return (
    <div
      className="chat-opacity-bar"
      title={`Overlay ${opacityPct}% — left more glass, right more solid`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="chat-opacity-bar__label" aria-hidden="true">
        Glass
      </span>
      <input
        type="range"
        className="chat-opacity-bar__range"
        min={CHAT_OVERLAY_SLIDER_MIN}
        max={CHAT_OVERLAY_SLIDER_MAX}
        step={1}
        value={value}
        aria-label="Chat glass transparency"
        aria-valuetext={`${opacityPct} percent opaque`}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(CHAT_OVERLAY_SLIDER_DEFAULT)}
      />
      <span className="chat-opacity-bar__value">{opacityPct}%</span>
    </div>
  );
}
