import { describe, expect, it } from "vitest";
import { applyTripProposal, type ItineraryItem } from "@raiquora/trip/trip";
import { effectiveTripConstraints, type TripRequest } from "@raiquora/trip/trip-request";
import { proposeAssumptionDecision, proposeProfilePreference, proposeTripRequestUpdate } from "./update-trip-request";
import { assumedRequest, requestTrip, requestConstraint, providerRequestPlace } from "../../../../modules/trip/domain/trip-request.fixture";
import { planAssumptionViews } from "../../presentation/trip-plan/plan-assumption-view";
import type { UserProfile } from "@raiquora/trip/travel-profile";

describe("request proposals and assumption UI boundary", () => {
  it.each(["model", "profile", "legacy"] as const)("confirms/rejects %s through explicit proposals with source and strength intact", (source) => {
    const trip = requestTrip(assumedRequest(source));
    const before = structuredClone(trip);
    const view = planAssumptionViews(trip)[0]!;
    expect(view.text).toContain("⚠ 仮置き");
    for (const action of view.actions) {
      const proposal = proposeAssumptionDecision(trip, action.assumptionId, action.status);
      const updated = applyTripProposal(trip, proposal);
      expect(updated.request.assumptions[0]!.status).toBe(action.status);
      expect(updated.request.constraints).toEqual(trip.request.constraints);
      expect(updated.request.constraints[0]!.strength).toBe("hard");
      expect(effectiveTripConstraints(updated.request)).toHaveLength(action.status === "confirmed" ? 1 : 0);
      expect(planAssumptionViews(updated)[0]!.actions).toEqual([]);
      expect(applyTripProposal(updated, proposeAssumptionDecision(updated, action.assumptionId, action.status))).toEqual(updated);
      expect(() => proposeAssumptionDecision(updated, action.assumptionId, action.status === "confirmed" ? "rejected" : "confirmed")).toThrow();
    }
    expect(trip).toEqual(before);
    expect(() => proposeAssumptionDecision(trip, "missing", "confirmed")).toThrow();
  });
  it("requires explicit item repairs in the same atomic rejection and cannot partially apply", () => {
    const item: ItineraryItem = { id: "rail", title: "移動", type: "transport", detail: { status: "unresolved" }, schedule: { type: "day", date: "2026-09-21" } };
    const request = assumedRequest();
    const linked: TripRequest = { ...request, assumptions: request.assumptions.map((a) => ({ ...a, affects: [...a.affects, { type: "item", itemId: "rail", field: "schedule" }] })) };
    const trip = requestTrip(linked, [item]);
    const before = structuredClone(trip);
    expect(() => proposeAssumptionDecision(trip, "assumption", "rejected")).toThrow();
    expect(trip).toEqual(before);
    const proposal = proposeAssumptionDecision(trip, "assumption", "rejected", [{ type: "replace", itemId: "rail", item: { ...item, schedule: { type: "unscheduled" } } }]);
    const updated = applyTripProposal(trip, proposal);
    expect(updated.items[0]!.schedule).toEqual({ type: "unscheduled" });
    expect(effectiveTripConstraints(updated.request)).toEqual([]);
    expect(updated.revision).toBe(trip.revision); // #389 owns CAS/revision, not this memory boundary.
    expect(updated.updatedAt).toBe(trip.updatedAt);
    expect(trip).toEqual(before);
    expect(() => proposeAssumptionDecision(trip, "assumption", "rejected", [{ type: "replace", itemId: "missing", item }])).toThrow();
  });
  it("never promotes new model interpretations or decisions to user/profile facts", () => {
    const trip = requestTrip();
    const request = assumedRequest();
    const proposal = proposeTripRequestUpdate(trip, request, "model");
    expect(trip.request.constraints).toEqual([]);
    expect(applyTripProposal(trip, proposal).request).toEqual(request);
    for (const source of ["user", "profile", "legacy"] as const) {
      expect(() => proposeTripRequestUpdate(trip, { ...request, constraints: request.constraints.map((c) => ({ ...c, source })) }, "model")).toThrow();
    }
    expect(() => proposeTripRequestUpdate(trip, { ...request, assumptions: request.assumptions.map((a) => ({ ...a, status: "confirmed" })) }, "model")).toThrow();
    expect(() => proposeTripRequestUpdate(trip, { ...request, goal: "model interpretation" }, "model")).toThrow();
    const updated = applyTripProposal(trip, proposal);
    expect(() => proposeTripRequestUpdate(updated, { constraints: [], assumptions: [] }, "model")).toThrow();
  });
  it("lets explicit user adoption change request without inferring or rewriting the schedule", () => {
    const trip = requestTrip();
    const request = { goal: "景色をゆっくり楽しむ", constraints: [requestConstraint({ type: "duration", unit: "nights", minimum: 1, maximum: 2 })], assumptions: [] };
    expect(applyTripProposal(trip, proposeTripRequestUpdate(trip, request, "user")).request).toEqual(request);
    expect(trip.request.constraints).toEqual([]);
  });
  it("allows a hypothetical name but not invented provider evidence or coordinates", () => {
    const assumed = assumedRequest();
    const withPlace = (place: ReturnType<typeof providerRequestPlace>): TripRequest => ({ ...assumed,
      constraints: assumed.constraints.map((c) => ({ ...c, requirement: { type: "origin", place } })) });
    expect(() => proposeTripRequestUpdate(requestTrip(), withPlace({ name: "京都駅", sources: [] }), "model")).not.toThrow();
    expect(() => proposeTripRequestUpdate(requestTrip(), withPlace(providerRequestPlace()), "model")).toThrow("trusted resolution");
    expect(() => proposeTripRequestUpdate(requestTrip(), withPlace({ name: "京都駅", sources: [], coordinate: { longitude: 135, latitude: 35 } }), "model")).toThrow("trusted resolution");
  });
  it("selects individual profile preferences as profile, optionally assumed, never the whole profile", () => {
    const profile = { home: { station: "private-home", carAvailable: false }, travelStyle: { pace: 0.2 }, preferences: { nature: 0.9 },
      transport: { maxTypicalTravelMinutes: 120 }, updatedAt: "private-metadata" } as UserProfile;
    const trip = requestTrip();
    const before = structuredClone(profile);
    for (const choice of [{ field: "pace" }, { field: "carAvailable" }, { field: "maxTravelMinutes" }, { field: "interest", preference: "nature" }] as const) {
      const updated = applyTripProposal(trip, proposeProfilePreference(trip, profile, choice, { constraintId: "profile", assumptionId: "profile-assumption" }));
      expect(updated.request.constraints[0]!.source).toBe("profile");
      expect(updated.request.assumptions[0]).toMatchObject({ source: "profile", status: "unconfirmed" });
      expect(JSON.stringify(updated.request)).not.toMatch(/private-home|private-metadata|updatedAt/);
    }
    const adopted = applyTripProposal(trip, proposeProfilePreference(trip, profile, { field: "pace" }, { constraintId: "pace" }));
    const explicit = applyTripProposal(adopted, proposeTripRequestUpdate(adopted, { ...adopted.request, constraints: [
      ...adopted.request.constraints, requestConstraint({ type: "pace", value: 0.9 }),
    ] }, "user"));
    expect(effectiveTripConstraints(explicit.request)).toEqual([requestConstraint({ type: "pace", value: 0.9 })]);
    expect(profile).toEqual(before);
    expect(() => proposeProfilePreference(trip, { ...profile, transport: { maxTypicalTravelMinutes: null } }, { field: "maxTravelMinutes" }, { constraintId: "none" })).toThrow();
  });
});
