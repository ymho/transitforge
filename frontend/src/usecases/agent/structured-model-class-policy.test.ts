import { describe, expect, it } from "vitest";

import { structuredModelClassPolicy } from "./structured-model-class-policy";

describe("structuredModelClassPolicy", () => {
  it("keeps an initial request on the default model", () => {
    expect(structuredModelClassPolicy({
      request: { executionId: "1", feature: "concierge", userRequest: "旅行したい" },
      phase: "initial",
    })).toBeUndefined();
  });

  it("uses decision class for a verified current journey", () => {
    expect(structuredModelClassPolicy({
      request: {
        executionId: "1", feature: "concierge", userRequest: "新幹線を避けたい",
        context: { currentJourney: { contextKind: "previous_verified_journey" } },
      },
      phase: "initial",
    })).toBe("decision");
  });

  it("uses decision class after a tool result", () => {
    expect(structuredModelClassPolicy({
      request: { executionId: "1", feature: "concierge", userRequest: "候補を探して" },
      phase: "result_driven_replan",
    })).toBe("decision");
  });
});
