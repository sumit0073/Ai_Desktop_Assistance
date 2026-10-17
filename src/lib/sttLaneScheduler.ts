/**
 * Per-source STT scheduling rules for interim vs final requests.
 * Pure logic — kept separate from the React hook for regression tests.
 */

export type SttLaneKind = "microphone" | "meeting";

export type SttLaneDecision =
  | { action: "start"; abortPriorInterim: boolean }
  | {
      action: "drop";
      reason: "final_in_flight" | "interim_in_flight" | "stale_generation";
    };

export type SttLaneState = {
  /** Monotonic generation; bumped whenever a new request is accepted. */
  generation: number;
  interimInFlight: boolean;
  finalInFlight: boolean;
  /** Generation of the in-flight interim (if any). */
  interimGeneration: number | null;
  /** Generation of the in-flight final (if any). */
  finalGeneration: number | null;
};

export function createSttLaneState(): SttLaneState {
  return {
    generation: 0,
    interimInFlight: false,
    finalInFlight: false,
    interimGeneration: null,
    finalGeneration: null,
  };
}

/**
 * Decide whether to start STT for an incoming segment.
 *
 * Latency rule: do NOT abort an in-flight interim when a newer partial arrives.
 * Abort-churn prevented the first turbo result from ever completing (~5s feel).
 * Drop extra partials while one interim is running; finals always win.
 */
export function decideSttLaneRequest(
  state: SttLaneState,
  isPartial: boolean,
): SttLaneDecision & { next: SttLaneState } {
  if (isPartial) {
    if (state.finalInFlight) {
      return { action: "drop", reason: "final_in_flight", next: state };
    }
    if (state.interimInFlight) {
      return { action: "drop", reason: "interim_in_flight", next: state };
    }
    const generation = state.generation + 1;
    return {
      action: "start",
      abortPriorInterim: false,
      next: {
        ...state,
        generation,
        interimInFlight: true,
        interimGeneration: generation,
      },
    };
  }

  const generation = state.generation + 1;
  return {
    action: "start",
    abortPriorInterim: state.interimInFlight,
    next: {
      ...state,
      generation,
      interimInFlight: false,
      interimGeneration: null,
      finalInFlight: true,
      finalGeneration: generation,
    },
  };
}

/** Mark a request finished; ignore stale completions from aborted gens. */
export function completeSttLaneRequest(
  state: SttLaneState,
  params: { generation: number; isPartial: boolean },
): { accept: boolean; next: SttLaneState } {
  if (params.isPartial) {
    if (state.interimGeneration !== params.generation) {
      return { accept: false, next: state };
    }
    return {
      accept: true,
      next: {
        ...state,
        interimInFlight: false,
        interimGeneration: null,
      },
    };
  }
  if (state.finalGeneration !== params.generation) {
    return { accept: false, next: state };
  }
  return {
    accept: true,
    next: {
      ...state,
      finalInFlight: false,
      finalGeneration: null,
    },
  };
}

/**
 * Whether a completed STT result may update the UI.
 * Stale interim results must not overwrite a newer interim or any final.
 */
export function shouldApplySttResult(
  state: SttLaneState,
  params: {
    generation: number;
    isPartial: boolean;
    utteranceFinalized: boolean;
  },
): boolean {
  if (params.utteranceFinalized && params.isPartial) return false;
  if (params.isPartial) {
    // Still the active interim gen, and no final has taken over.
    return (
      state.interimGeneration === params.generation && !state.finalInFlight
    );
  }
  return state.finalGeneration === params.generation;
}
