/**
 * Same-utterance interim → final display rules.
 * Partials and finals share utteranceId; the UI replaces text in place
 * (never concatenates "And LLD." + "What is HLD and LLD?").
 */

export type LiveUtteranceApply = {
  /** Text to show in the bubble. */
  text: string;
  /** Whether the bubble should update. */
  apply: boolean;
  /** Drop the streaming bubble (empty / discarded interim). */
  clear?: boolean;
};

/**
 * Decide how to update a live transcript bubble for one utterance.
 * - Final always replaces interim text when same utterance.
 * - Late interim after finalize is ignored.
 * - Unrelated utterances are not merged here (caller creates a new bubble).
 */
export function applyLiveUtteranceUpdate(params: {
  incomingText: string;
  isPartial: boolean;
  sameUtterance: boolean;
  utteranceAlreadyFinalized: boolean;
}): LiveUtteranceApply {
  const text = params.incomingText.trim();
  if (!text) {
    return { text: "", apply: false, clear: params.isPartial };
  }
  if (params.isPartial && params.utteranceAlreadyFinalized) {
    return { text: "", apply: false };
  }
  if (!params.sameUtterance) {
    // New utterance — caller creates a bubble; we only report the text.
    return { text, apply: true };
  }
  // Same utterance: replace (do not concatenate interim + final).
  return { text, apply: true };
}
