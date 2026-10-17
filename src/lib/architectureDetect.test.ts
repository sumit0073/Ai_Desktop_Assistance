import { describe, expect, it } from "vitest";
import {
  getArchitectureDetail,
  hasMermaidBlock,
  isArchitectureAspectFollowUp,
  isArchitectureConceptQuestion,
  isFreshArchitectureTopic,
  looksLikeArchitecture,
} from "./architectureDetect";

describe("looksLikeArchitecture", () => {
  it("detects explicit architecture requests", () => {
    expect(looksLikeArchitecture("Design Uber high-level architecture")).toBe(
      true,
    );
    expect(looksLikeArchitecture("Show a Mermaid system design for Netflix")).toBe(
      true,
    );
    expect(
      looksLikeArchitecture("Design an e-commerce order management system"),
    ).toBe(true);
  });

  it("does not treat ordinary service/database questions as architecture", () => {
    expect(looksLikeArchitecture("Why is my database query slow?")).toBe(false);
    expect(looksLikeArchitecture("Which system service owns billing?")).toBe(
      false,
    );
  });

  it("does not treat HLD/LLD definition questions as architecture generation", () => {
    expect(isArchitectureConceptQuestion("What is HLD and LLD?")).toBe(true);
    expect(looksLikeArchitecture("What is HLD and LLD?")).toBe(false);
    expect(
      looksLikeArchitecture("What is the difference between HLD and LLD?"),
    ).toBe(false);
    expect(looksLikeArchitecture("Explain high-level design vs low-level design")).toBe(
      false,
    );
    expect(getArchitectureDetail("What is HLD and LLD?")).toBe("medium");
  });

  it("still treats design-for-system phrasing as architecture", () => {
    expect(looksLikeArchitecture("What is the architecture for Uber?")).toBe(
      true,
    );
    expect(looksLikeArchitecture("Write an HLD for a chat app")).toBe(true);
    expect(isArchitectureConceptQuestion("What is the architecture for Uber?")).toBe(
      false,
    );
  });

  it("requires stronger wording for screenshot prompts", () => {
    expect(
      looksLikeArchitecture("Please review this service database queue", true),
    ).toBe(false);
    expect(
      looksLikeArchitecture("Draw the architecture for this system", true),
    ).toBe(true);
  });
});

describe("getArchitectureDetail", () => {
  it("defaults to medium", () => {
    expect(getArchitectureDetail("Architecture for a chat app")).toBe("medium");
    expect(getArchitectureDetail("high-level architecture overview")).toBe(
      "medium",
    );
  });

  it("switches to detailed when explicitly requested", () => {
    expect(getArchitectureDetail("detailed architecture please")).toBe(
      "detailed",
    );
    expect(getArchitectureDetail("expand the architecture")).toBe("detailed");
    expect(getArchitectureDetail("zoom into matching service")).toBe("detailed");
    expect(getArchitectureDetail("show internal services / LLD")).toBe(
      "detailed",
    );
  });
});

describe("isArchitectureAspectFollowUp", () => {
  it("treats scalability questions as aspect follow-ups, not full redesigns", () => {
    expect(isArchitectureAspectFollowUp("What about scalability?")).toBe(true);
    expect(looksLikeArchitecture("What about scalability?")).toBe(false);
  });

  it("does not treat explicit redesign as an aspect follow-up", () => {
    expect(
      isArchitectureAspectFollowUp(
        "Design a full architecture for a scalable e-commerce system",
      ),
    ).toBe(false);
  });
});

describe("isFreshArchitectureTopic", () => {
  it("detects a new system after a prior architecture thread", () => {
    expect(
      isFreshArchitectureTopic(
        "Now design the architecture for Netflix",
        true,
      ),
    ).toBe(true);
  });

  it("does not treat expansions as a fresh topic", () => {
    expect(
      isFreshArchitectureTopic("expand the matching service", true),
    ).toBe(false);
    expect(
      isFreshArchitectureTopic("more detail on the same system", true),
    ).toBe(false);
  });
});

describe("hasMermaidBlock", () => {
  it("detects fenced mermaid", () => {
    expect(hasMermaidBlock("```mermaid\nflowchart TB\nA-->B\n```")).toBe(true);
    expect(hasMermaidBlock("no diagram here")).toBe(false);
  });
});
