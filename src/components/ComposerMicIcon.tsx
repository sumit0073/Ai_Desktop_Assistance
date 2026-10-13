type Props = {
  listening?: boolean;
  busy?: boolean;
};

/** Simple mic / stop icon for the in-field voice control. */
export function ComposerMicIcon({ listening = false, busy = false }: Props) {
  if (busy) {
    return (
      <svg
        className="composer-input-mic__icon"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="40"
          strokeLinecap="round"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    );
  }

  if (listening) {
    return (
      <svg
        className="composer-input-mic__icon"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        aria-hidden="true"
      >
        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      className="composer-input-mic__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.07A7 7 0 0 0 17 11z"
      />
    </svg>
  );
}
