import { describe, expect, it } from "vitest";
import {
  completeSttLaneRequest,
  createSttLaneState,
  decideSttLaneRequest,
  shouldApplySttResult,
} from "./sttLaneScheduler";

describe("sttLaneScheduler", () => {
  it("starts interim and bumps generation", () => {
    const state = createSttLaneState();
    const d = decideSttLaneRequest(state, true);
    expect(d.action).toBe("start");
    if (d.action !== "start") return;
    expect(d.abortPriorInterim).toBe(false);
    expect(d.next.interimInFlight).toBe(true);
    expect(d.next.generation).toBe(1);
  });

  it("drops newer interim while one is in flight (avoid abort churn)", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, true).next;
    const d = decideSttLaneRequest(state, true);
    expect(d.action).toBe("drop");
    if (d.action !== "drop") return;
    expect(d.reason).toBe("interim_in_flight");
    expect(d.next.interimGeneration).toBe(state.interimGeneration);
  });

  it("drops interim while final is in flight", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, false).next;
    const d = decideSttLaneRequest(state, true);
    expect(d.action).toBe("drop");
    if (d.action !== "drop") return;
    expect(d.reason).toBe("final_in_flight");
  });

  it("final aborts interim and takes priority", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, true).next;
    const d = decideSttLaneRequest(state, false);
    expect(d.action).toBe("start");
    if (d.action !== "start") return;
    expect(d.abortPriorInterim).toBe(true);
    expect(d.next.finalInFlight).toBe(true);
    expect(d.next.interimInFlight).toBe(false);
  });

  it("rejects stale interim completion after final took over", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, true).next;
    const gen1 = state.generation;
    state = decideSttLaneRequest(state, false).next;
    const stale = completeSttLaneRequest(state, {
      generation: gen1,
      isPartial: true,
    });
    expect(stale.accept).toBe(false);
  });

  it("shouldApplySttResult blocks late partial after utterance finalized", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, true).next;
    expect(
      shouldApplySttResult(state, {
        generation: state.generation,
        isPartial: true,
        utteranceFinalized: true,
      }),
    ).toBe(false);
  });

  it("shouldApplySttResult blocks interim once final is in flight", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, true).next;
    const interimGen = state.generation;
    state = decideSttLaneRequest(state, false).next;
    expect(
      shouldApplySttResult(state, {
        generation: interimGen,
        isPartial: true,
        utteranceFinalized: false,
      }),
    ).toBe(false);
  });

  it("shouldApplySttResult accepts matching final generation", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, false).next;
    expect(
      shouldApplySttResult(state, {
        generation: state.generation,
        isPartial: false,
        utteranceFinalized: false,
      }),
    ).toBe(true);
  });

  it("allows a new interim after the previous completes", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, true).next;
    const gen = state.generation;
    state = completeSttLaneRequest(state, {
      generation: gen,
      isPartial: true,
    }).next;
    const again = decideSttLaneRequest(state, true);
    expect(again.action).toBe("start");
  });

  it("keeps microphone and meeting lanes independent", () => {
    let mic = createSttLaneState();
    let meeting = createSttLaneState();
    mic = decideSttLaneRequest(mic, false).next;
    const meetingPartial = decideSttLaneRequest(meeting, true);
    expect(meetingPartial.action).toBe("start");
    expect(mic.finalInFlight).toBe(true);
    expect(meetingPartial.next.interimInFlight).toBe(true);
  });

  it("interim then final: final wins and stale interim cannot apply", () => {
    let state = createSttLaneState();
    state = decideSttLaneRequest(state, true).next;
    const interimGen = state.generation;
    expect(
      shouldApplySttResult(state, {
        generation: interimGen,
        isPartial: true,
        utteranceFinalized: false,
      }),
    ).toBe(true);

    state = decideSttLaneRequest(state, false).next;
    const finalGen = state.generation;
    expect(
      shouldApplySttResult(state, {
        generation: interimGen,
        isPartial: true,
        utteranceFinalized: false,
      }),
    ).toBe(false);
    expect(
      shouldApplySttResult(state, {
        generation: finalGen,
        isPartial: false,
        utteranceFinalized: false,
      }),
    ).toBe(true);
  });
});

