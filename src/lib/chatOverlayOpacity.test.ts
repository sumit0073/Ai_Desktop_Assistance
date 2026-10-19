import { describe, expect, it } from "vitest";
import {
  CHAT_OVERLAY_SLIDER_DEFAULT,
  chatOverlayCssVars,
  sliderToOpacity,
} from "./chatOverlayOpacity";

describe("sliderToOpacity", () => {
  it("maps left to 5% opaque", () => {
    expect(sliderToOpacity(0)).toBeCloseTo(0.05);
  });

  it("maps right to fully opaque", () => {
    expect(sliderToOpacity(100)).toBeCloseTo(1);
  });

  it("maps middle default to halfway glass", () => {
    expect(sliderToOpacity(CHAT_OVERLAY_SLIDER_DEFAULT)).toBeCloseTo(0.525);
  });
});

describe("chatOverlayCssVars", () => {
  it("writes concrete --glass colors so the slider can change them", () => {
    const left = chatOverlayCssVars(0, "light");
    const right = chatOverlayCssVars(100, "light");
    expect(left["--glass"]).toContain("0.05");
    expect(right["--glass"]).toContain("1)");
    expect(left["--glass"]).not.toBe(right["--glass"]);
  });
});
