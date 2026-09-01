import { describe, expect, it } from "vitest";

import { structuredModelClassPolicy } from "./structured-model-class-policy";

describe("structuredModelClassPolicy", () => {
  it("keeps an initial request on the default model", () => {
    expect(structuredModelClassPolicy({
      request: { executionId: "1", feature: "concierge", userRequest: "旅行したい" },
      phase: "initial",
    })).toBeUndefined();
  });

  it("uses decision class for fresh preference discovery without a known destination", () => {
    expect(structuredModelClassPolicy({
      request: {
        executionId: "1", feature: "concierge", userRequest: "リラックスしたい",
        context: { travelProfile: { pace: 0.2 } },
      },
      phase: "initial",
    })).toBe("decision");
  });

  it("uses decision class for structured destination inspiration", () => {
    expect(structuredModelClassPolicy({
      request: {
        executionId: "1", feature: "concierge", userRequest: "出雲大社へ行きたい",
        context: {
          travelProfile: { pace: 0.2 },
          tripContext: { planningStage: "inspiration", destinationWish: "出雲大社" },
        },
      },
      phase: "initial",
    })).toBe("decision");
  });

  it("uses decision class when the date and stay length are ready to plan", () => {
    expect(structuredModelClassPolicy({
      request: {
        executionId: "1", feature: "concierge", userRequest: "2泊",
        context: { tripContext: {
          planningStage: "planning", destinationWish: "出雲大社",
          startDate: "2026-08-31", stayNights: 2,
        } },
      },
      phase: "initial",
    })).toBe("decision");
  });

  it("keeps incomplete planning on the default model", () => {
    expect(structuredModelClassPolicy({
      request: {
        executionId: "1", feature: "concierge", userRequest: "明日",
        context: { tripContext: {
          planningStage: "planning", destinationWish: "出雲大社",
          startDate: "2026-08-31",
        } },
      },
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

  it("uses decision class for a current trip change", () => {
    expect(structuredModelClassPolicy({
      request: {
        executionId: "1", feature: "concierge", userRequest: "21時までに帰りたい",
        context: { currentTrip: { destination: "出雲大社" } },
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
