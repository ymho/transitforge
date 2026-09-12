import { describe, expect, it } from "vitest";
import { createAgentContextSnapshot } from "./agent-context-snapshot";
import { agentDecisionContextText, buildAgentDecisionContext } from "./agent-decision-context";
import type { AgentDecisionSummary } from "./agent-decision-summary";
import { requestTrip, assumedRequest, requestConstraint, requestAt, providerRequestPlace } from "../../../../modules/trip/domain/trip-request.fixture";
import type { TripRequest } from "@raiquora/trip/trip-request";

const decision: AgentDecisionSummary = { interpretedGoal: "今回の解釈", selectedAction: "ask_user", hardConstraints: [{ key: "nights", value: 9 }],
  softPreferences: [], unresolvedFacts: ["confirmation"], reasonCodes: ["user_confirmation_required"] };
function contextFor(request: TripRequest) {
  const trip = requestTrip(request);
  const snapshot = createAgentContextSnapshot(undefined, trip);
  const context = buildAgentDecisionContext({ executionId: "trip-request", feature: "concierge", userRequest: "この条件で考えて",
    context: { currentTrip: { ...snapshot.trip, effectiveHardConstraints: [{ id: "not-the-source-of-truth" }] }, currentTurnDecision: decision, travelProfile: { home: { station: "普段の駅" }, favoriteInterests: ["海"] },
      tripContext: { stayNights: 5, startDate: "2020-01-01" },
      knownHardConstraints: [{ key: "stayNights", value: 5, source: "trip_context" }],
      knownSoftPreferences: [{ key: "pace", value: 0.9, source: "conversation" }],
    } }, []);
  return { trip, context, snapshot };
}
function parsed(context: ReturnType<typeof contextFor>["context"]) {
  return JSON.parse(agentDecisionContextText(context).match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
}
describe("Trip V2 request -> Agent read projection", () => {
  it("separates persisted request, effective hard/soft, assumptions, profile and transient decision", () => {
    const assumed = assumedRequest();
    const request: TripRequest = { ...assumed, goal: "自然を楽しむ", constraints: [...assumed.constraints,
      requestConstraint({ type: "arrive_by", at: requestAt, place: providerRequestPlace() }, { id: "arrival" }),
      requestConstraint({ type: "mobility", maxTransfers: 1 }, { id: "transfers", strength: "soft" }),
      requestConstraint({ type: "duration", unit: "nights", minimum: 1, maximum: 1 }, { id: "nights" }),
    ] };
    const before = structuredClone(request);
    const { trip, context, snapshot } = contextFor(request);
    const result = parsed(context);
    expect(result.persistedTripRequest).toEqual(request);
    expect(result.tripHardConstraints.map((c: { id: string }) => c.id)).toEqual(["condition", "arrival", "nights"]);
    expect(result.tripSoftPreferences.map((c: { id: string }) => c.id)).toEqual(["transfers"]);
    expect(result.unconfirmedAssumptions).toEqual(assumed.assumptions);
    expect(result.currentTurnDecision).toEqual(decision);
    expect(result.travelProfile.home.station).toBe("普段の駅");
    expect(result.tripContext).toBeUndefined();
    expect(result.knownHardConstraints).toEqual([]);
    expect(result.knownSoftPreferences).toEqual([]);
    expect(result.currentTrip.request).toBeUndefined();
    expect(trip.request).toEqual(before);
    expect(snapshot.trip!.request).not.toBe(trip.request);
    expect(request).toEqual(before);
    expect(JSON.stringify(trip.request)).not.toContain("今回の解釈");
  });
  it("keeps rejected assumptions in the record but not in the effective search conditions", () => {
    const request = assumedRequest();
    const result = parsed(contextFor({ ...request, assumptions: request.assumptions.map((a) => ({ ...a, status: "rejected" })) }).context);
    expect(result.persistedTripRequest.assumptions[0].status).toBe("rejected");
    expect(result.tripHardConstraints).toEqual([]);
    expect(result.unconfirmedAssumptions).toEqual([]);
  });
  it("retains full date ranges, >20 constraints, opaque place IDs and assumption links during compaction", () => {
    const request = assumedRequest();
    const place = providerRequestPlace();
    const large = { ...request, constraints: [...request.constraints, ...Array.from({ length: 24 }, (_, n) =>
      requestConstraint({ type: "experience", intent: "prefer", text: `希望${n}` }, { id: `preference-${n}`, strength: "soft" })),
      requestConstraint({ type: "dates", start: { earliest: "2026-09-20", latest: "2026-09-22" } }, { id: "date-range" }),
      requestConstraint({ type: "origin", place: { ...place, coordinate: { longitude: 135, latitude: 35 } } }, { id: "origin" })] };
    const { context } = contextFor(large);
    context.currentJourney = { journeys: Array.from({ length: 20 }, () => ({ description: "長い経路候補".repeat(500) })) };
    const result = parsed(context);
    expect(result.contextTruncated).toBe(true);
    expect(result.persistedTripRequest.constraints).toHaveLength(27);
    expect(result.persistedTripRequest.constraints.at(-1).requirement.place.ref).toEqual(place.ref);
    expect(result.persistedTripRequest.constraints.at(-1).requirement.place.coordinate).toBeUndefined();
    expect(result.persistedTripRequest.constraints.at(-2).requirement.start).toEqual({ earliest: "2026-09-20", latest: "2026-09-22" });
    expect(result.unconfirmedAssumptions).toEqual(request.assumptions);
    expect(result.travelProfile.home.station).toBe("普段の駅");
    expect(result.currentTurnDecision).toEqual(decision);
  });
  it("fails the bounded message rather than silently omitting an oversized persisted requirement", () => {
    const { context } = contextFor({ constraints: [requestConstraint({ type: "experience", intent: "must", text: "条件".repeat(13000) })], assumptions: [] });
    expect(() => agentDecisionContextText(context)).toThrow("bounded message budget");
  });
  it("retains item-scoped references in both schedule and constraints", () => {
    const trip = requestTrip({ constraints: [requestConstraint({ type: "pace", value: 0.2 }, { scope: { type: "item", itemId: "visit" } })], assumptions: [] },
      [{ id: "visit", title: "宿泊地", type: "stay", selection: { status: "unselected" }, schedule: { type: "day", date: "2026-09-21" } }]);
    const snapshot = createAgentContextSnapshot(undefined, trip);
    const context = buildAgentDecisionContext({ executionId: "item", feature: "concierge", userRequest: "相談", context: { currentTrip: snapshot.trip } }, []);
    const result = parsed(context);
    expect(result.currentTrip.schedule[0].itemId).toBe(result.tripHardConstraints[0].scope.itemId);
  });
});
