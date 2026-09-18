import { describe, expect, it } from "vitest";

import { structuredModelClassPolicy } from "./structured-model-class-policy";

describe("structuredModelClassPolicy", () => {
  it("uses the decision model for already-read source explanation without routing on wording", () => {
    expect(structuredModelClassPolicy({ request: { executionId: "source", feature: "journey_planning", userRequest: "比較",
      initialEvidence: [{ id: "source-1", category: "external", knowledgeKind: "deterministic_fact", subject: "場所", facts: {
        sourceExcerpt: "歴史ある町並み", status: "available", freshness: "fresh",
      }, references: [] }] }, phase: "initial" })).toBe("decision");
  });
  it("does not promote timetable facts merely because Evidence exists", () => {
    expect(structuredModelClassPolicy({ request: { executionId: "rail", feature: "journey_planning", userRequest: "確認",
      initialEvidence: [{ id: "route-1", category: "journey", knowledgeKind: "derived_value", subject: "経路",
        facts: { durationMinutes: 30 }, references: [] }] }, phase: "initial" })).toBeUndefined();
  });
  it("uses decision class for an unframed concierge request even without a profile", () => {
    expect(structuredModelClassPolicy({
      request: { executionId: "1", feature: "concierge", userRequest: "旅行したい" },
      phase: "initial",
    })).toBe("decision");
  });

  it("does not promote an unframed non-concierge request", () => {
    expect(structuredModelClassPolicy({
      request: { executionId: "1", feature: "train_guidance", userRequest: "列車を見たい" },
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

  it("treats an empty TripContext as destination discovery", () => {
    expect(structuredModelClassPolicy({
      request: {
        executionId: "1", feature: "concierge", userRequest: "リラックスできる観光したい",
        context: { travelProfile: { pace: 0.2 }, tripContext: {} },
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

  it("does not downgrade structured discovery just because a profile is absent", () => {
    expect(structuredModelClassPolicy({
      request: { executionId: "1", feature: "concierge", userRequest: "地域から相談したい",
        context: { tripContext: { planningStage: "inspiration" } },
      }, phase: "initial",
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

  it("does not change incomplete planning routing solely because place facts are available", () => {
    expect(structuredModelClassPolicy({
      request: { executionId: "1", feature: "concierge", userRequest: "旅程を考えたい", context: {
        tripContext: { planningStage: "planning", destinationWish: "確認済み地点" },
        verifiedFacts: [{ evidenceId: "place:verified", category: "place", subject: "確認済み地点", summary: "所在地を確認済み" }],
      } },
      phase: "initial",
    })).toBeUndefined();
  });
});
