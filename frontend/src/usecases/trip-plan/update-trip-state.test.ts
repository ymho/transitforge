import { describe, expect, it } from "vitest";
import { requestTrip, requestRailItem } from "../../../../modules/trip/domain/trip-request.fixture";
import { applyTripProposal } from "@raiquora/trip/trip";
import { confirmTripLifecycle, proposeTripPlanningState, proposeScheduledLifecycle } from "./update-trip-state";

describe("state proposal application boundary", () => {
  it("proposes progress without mutation, stage ordering or tool instructions", () => {
    const trip = requestTrip(undefined, [requestRailItem()]);
    const before = structuredClone(trip);
    const proposal = proposeTripPlanningState(trip, "itinerary_draft");
    expect(trip).toEqual(before);
    expect(applyTripProposal(trip, proposal).planningState).toBe("itinerary_draft");
    expect(JSON.stringify(proposal)).not.toMatch(/tool|question|router/i);
  });
  it("requires current real Clock again at application, not stale proposal evidence", () => {
    const trip = requestTrip(undefined, [requestRailItem()]);
    const now = { now: () => new Date("2026-09-13T00:30:00Z") };
    const proposal = proposeScheduledLifecycle(trip, now)!;
    expect(proposal.patches).toEqual([{ type: "lifecycle", state: "in_trip", basis: "schedule" }]);
    expect(() => applyTripProposal(trip, proposal)).toThrow();
    const during = applyTripProposal(trip, proposal, { clock: now });
    expect(during.lifecycleState).toBe("in_trip");
    expect(trip.lifecycleState).toBe("pre_trip");
    expect(() => applyTripProposal(trip, proposal, { clock: { now: () => new Date("2026-09-14T00:00:00Z") } })).toThrow();
    expect(proposeScheduledLifecycle(during, now)).toBeUndefined();
  });
  it("offers pre_trip for a future adopted itinerary, not from Request", () => {
    const trip = { ...requestTrip(undefined, [requestRailItem()]), lifecycleState: "in_trip" as const };
    const clock = { now: () => new Date("2026-09-12T00:00:00Z") };
    const proposal = proposeScheduledLifecycle(trip, clock)!;
    expect(applyTripProposal(trip, proposal, { clock }).lifecycleState).toBe("pre_trip");
  });
  it("keeps completed/cancelled sticky and only accepts explicit user completion", () => {
    const trip = requestTrip(undefined, [requestRailItem()]);
    for (const state of ["cancelled", "completed"] as const) {
      const confirmed = confirmTripLifecycle(trip, state);
      expect(confirmed.lifecycleState).toBe(state);
      expect(proposeScheduledLifecycle(confirmed, { now: () => new Date("2026-09-13T00:30:00Z") })).toBeUndefined();
      expect(confirmTripLifecycle(confirmed, state)).toEqual(confirmed);
    }
  });
});
