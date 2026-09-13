import { describe, expect, it } from "vitest";
import { applyTripProposal, validateTrip, type Trip, type TripPatch } from "./trip";
import { validatePlanningState, type PlanningState } from "./trip-state";
import { requestTrip, requestRailItem, requestConstraint } from "./trip-request.fixture";

const tripWithItems = () => requestTrip(undefined, [requestRailItem()]);
const apply = (trip: Trip, patches: TripPatch[]) => applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "状態の提案", patches });

describe("Trip planning/lifecycle invariants", () => {
  it.each(["inspiration", "candidate_discovery", "candidate_selection", "itinerary_draft", "itinerary_refinement"] as PlanningState[])("supports %s without a mandatory phase sequence", (state) => {
    const trip = tripWithItems();
    const result = apply(trip, [{ type: "planning", state }]);
    expect(result.planningState).toBe(state);
    expect(result.request).toEqual(trip.request);
    expect(result.lifecycleState).toBe("pre_trip");
    expect(trip.planningState).toBe("inspiration");
  });
  it("supports direction changes and refinement during a trip", () => {
    const trip = { ...tripWithItems(), lifecycleState: "in_trip" as const };
    const refined = apply(trip, [{ type: "planning", state: "itinerary_refinement" }]);
    expect(refined.lifecycleState).toBe("in_trip");
    expect(apply(refined, [{ type: "planning", state: "candidate_discovery" }]).planningState).toBe("candidate_discovery");
  });
  it("reads persisted ready independently of derived feasibility; Application owns certification", () => {
    expect(() => validatePlanningState("ready")).not.toThrow();
    expect(() => apply(requestTrip(), [{ type: "planning", state: "ready" }])).toThrow(/items/);
    for (const trip of [tripWithItems(), requestTrip({ constraints: [requestConstraint({ type: "dates", start: { earliest: "2020-01-01", latest: "2020-01-01" } })], assumptions: [] }, [requestRailItem()])]) {
      expect(apply(trip, [{ type: "planning", state: "ready" }]).planningState).toBe("ready");
      expect(() => validateTrip({ ...trip, planningState: "ready" })).not.toThrow();
    }
  });
  it.each(["itinerary_draft", "itinerary_refinement"] as const)("requires adopted items for %s, but not finalized selections", (state) => {
    expect(() => apply(requestTrip(), [{ type: "planning", state }])).toThrow(/items/);
    const draft = requestTrip(undefined, [{ id: "unresolved", title: "移動", type: "transport", detail: { status: "unresolved" }, schedule: { type: "unscheduled" } }]);
    expect(apply(draft, [{ type: "planning", state }]).planningState).toBe(state);
  });
  it("rejects invalid enum/extra fields and an unconfirmed lifecycle claim atomically", () => {
    const trip = tripWithItems(); const before = structuredClone(trip);
    for (const patch of [
      { type: "planning", state: "unknown" }, { type: "planning", state: "itinerary_draft", tool: "search" },
      { type: "lifecycle", state: "completed", basis: "user_confirmation" },
      { type: "lifecycle", state: "done", basis: "schedule" }, { type: "lifecycle", state: "in_trip" },
    ]) expect(() => apply(trip, [{ type: "planning", state: "candidate_selection" }, patch as TripPatch])).toThrow();
    expect(trip).toEqual(before);
  });
  it("requires a separate user confirmation; accepts completion without inventing item execution status", () => {
    const trip = tripWithItems();
    const proposal = { tripId: trip.id, baseRevision: trip.revision, summary: "終了を確認", patches: [{ type: "lifecycle" as const, state: "completed" as const, basis: "user_confirmation" as const }] };
    expect(() => applyTripProposal(trip, proposal, { confirmedLifecycle: "cancelled" })).toThrow();
    const completed = applyTripProposal(trip, proposal, { confirmedLifecycle: "completed" });
    expect(completed.lifecycleState).toBe("completed");
    expect(completed.items).toEqual(trip.items);
    expect(JSON.stringify(completed)).not.toContain("executionStatus");
    expect(completed.revision).toBe(trip.revision);
  });
  it.each(["cancelled", "completed"] as const)("does not revive terminal %s through a patch", (state) => {
    const trip = { ...tripWithItems(), lifecycleState: state };
    expect(() => applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "復活", patches: [
      { type: "lifecycle", state: "pre_trip", basis: "user_confirmation" },
    ] }, { confirmedLifecycle: "pre_trip" })).toThrow(/revived/);
  });
  it("request-only edits never silently change lifecycle, planning or items", () => {
    const trip = { ...tripWithItems(), lifecycleState: "in_trip" as const, planningState: "itinerary_refinement" as const };
    const request = { constraints: [requestConstraint({ type: "dates", start: { earliest: "2030-01-01", latest: "2030-01-01" } })], assumptions: [] };
    const changed = apply(trip, [{ type: "request", request }]);
    expect(changed).toEqual({ ...trip, request });
  });
});
