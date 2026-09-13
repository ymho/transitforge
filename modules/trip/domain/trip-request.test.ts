import { describe, expect, it } from "vitest";
import { validateTripRequest, effectiveTripConstraints, type TripRequest } from "./trip-request";
import { validateTripRequirement, type TripRequirement } from "./trip-requirement";
import { applyTripProposal } from "./trip";
import { requestAt, requestConstraint, requestTrip, assumedRequest, providerRequestPlace } from "./trip-request.fixture";

describe("Trip.request contract", () => {
  it("preserves hard arrival and soft transfers independently from assumption status", () => {
    const assumptions = assumedRequest();
    const request: TripRequest = { constraints: [
      requestConstraint({ type: "arrive_by", at: requestAt, place: { name: "京都", sources: [] } }),
      requestConstraint({ type: "mobility", maxTransfers: 1 }, { id: "transfer", strength: "soft" }),
      ...assumptions.constraints.map((c) => ({ ...c, id: "assumed" })),
    ], assumptions: assumptions.assumptions.map((a) => ({ ...a, affects: [{ type: "constraint", constraintId: "assumed" }] })) };
    const trip = requestTrip(request);
    expect(trip.request).toEqual(request);
    expect(trip.request.constraints.map((c) => c.strength)).toEqual(["hard", "soft", "hard"]);
    expect(trip.request.assumptions[0]!.status).toBe("unconfirmed");
  });
  it.each([
    { type: "origin", place: { name: "自宅近く", sources: [] } },
    { type: "destinations", places: [providerRequestPlace()], order: "flexible" },
    { type: "dates", start: { earliest: "2020-09-21", latest: "2020-09-21" } },
    { type: "dates", start: { earliest: "2026-09-20", latest: "2026-09-22" }, end: { earliest: "2026-09-23", latest: "2026-09-25" } },
    { type: "duration", unit: "nights", minimum: 0, maximum: 0 },
    { type: "duration", unit: "days", minimum: 1, maximum: 3 },
    { type: "depart_after", at: requestAt, place: providerRequestPlace() },
    { type: "mobility", modes: ["rail", "bus"], excludedModes: ["car"], requiredModes: ["rail"], maxTravelMinutes: 180, maxTransfers: 2, transferPace: "relaxed", rankingPreference: "fewest-transfers", carAvailable: false, excludedTrainNumbers: ["1M"] },
    ...["prefer", "must", "avoid"].map((intent) => ({ type: "experience", intent, text: "落ち着いた場所" })),
    { type: "pace", value: 0 }, { type: "relative_distance", direction: "nearer", comparedCandidateIds: ["candidate-a"] },
    { type: "adventure", intensity: 2, avoidedRisks: ["weather-exposure"] },
  ])("round-trips typed requirement without inventing defaults: %j", (requirement) => {
    const before = structuredClone(requirement);
    const trip = requestTrip({ constraints: [requestConstraint(requirement as TripRequirement)], assumptions: [] });
    expect(trip.request.constraints[0]!.requirement).toEqual(before);
    expect(requirement).toEqual(before);
    expect(trip.request.constraints[0]!.requirement).not.toBe(requirement);
  });
  it.each([
    { type: "dates", start: { earliest: "2026-02-30", latest: "2026-03-01" } },
    { type: "dates", start: { earliest: "2026-09-22", latest: "2026-09-20" } },
    { type: "dates", start: { earliest: "9/21頃", latest: "9/23" } },
    { type: "dates", start: { earliest: "2026-09-21", latest: "2026-09-23" }, timeZone: "unknown" },
    { type: "duration", unit: "nights", minimum: -1, maximum: 0 },
    { type: "duration", unit: "nights", minimum: undefined, maximum: 2 },
    { type: "duration", unit: "days", minimum: 0, maximum: 0 },
    { type: "arrive_by", at: { at: "2026-09-23T18:00:00" }, place: { name: "京都", sources: [] } },
    { type: "origin", place: { name: "駅", coordinate: { longitude: 181, latitude: 35 }, sources: [] } },
    { type: "origin", place: { name: "駅", raw: { payload: true }, sources: [] } },
    { type: "pace", value: NaN }, { type: "pace", value: 1.1 },
    { type: "mobility" }, { type: "mobility", maxTransfers: 4 }, { type: "mobility", maxTravelMinutes: Infinity },
    { type: "mobility", carAvailable: "false" }, { type: "mobility", modes: ["teleport"] },
    { type: "relative_distance", direction: "nearer", comparedCandidateIds: [] },
    { type: "budget", amount: 1000, currency: "JPY" }, { key: "whatever", value: true },
    { type: "pace", value: 0.3, raw: {} },
  ])("rejects invalid/unknown/deferred requirement: %j", (value) => {
    expect(() => validateTripRequirement(value as TripRequirement)).toThrow();
  });
  it.each(["model", "profile", "legacy"] as const)("requires reciprocal assumption links for %s", (source) => {
    const request = assumedRequest(source);
    expect(() => validateTripRequest(request, [])).not.toThrow();
    expect(() => validateTripRequest({ ...request, assumptions: [] }, [])).toThrow();
    expect(() => validateTripRequest({ ...request, constraints: [] }, [])).toThrow();
    expect(() => validateTripRequest({ ...request, constraints: request.constraints.map((c) => ({ ...c, source: "user" })) }, [])).toThrow();
    expect(() => validateTripRequest({ ...request, assumptions: request.assumptions.map((a) => ({ ...a, affects: [] })) }, [])).toThrow();
  });
  it("rejects duplicate IDs, unknown item scope and an assumption-source constraint without its link", () => {
    const request = assumedRequest();
    expect(() => validateTripRequest({ ...request, constraints: [...request.constraints, ...request.constraints] }, [])).toThrow();
    expect(() => validateTripRequest({ ...request, assumptions: [...request.assumptions, ...request.assumptions] }, [])).toThrow();
    expect(() => validateTripRequest({ ...request, constraints: request.constraints.map((c) => ({ ...c, assumptionId: undefined })) }, [])).toThrow();
    expect(() => validateTripRequest({ constraints: [requestConstraint({ type: "pace", value: 0.3 }, { scope: { type: "item", itemId: "missing" } })], assumptions: [] }, [])).toThrow();
  });
  it("uses current user values ahead of profile without losing unrelated mobility preferences", () => {
    const request: TripRequest = { constraints: [
      requestConstraint({ type: "mobility", maxTransfers: 0, maxTravelMinutes: 60, carAvailable: false }, { id: "profile", source: "profile", strength: "soft" }),
      requestConstraint({ type: "mobility", maxTravelMinutes: 240, carAvailable: true }),
      requestConstraint({ type: "pace", value: 0.2 }, { source: "profile", id: "profile-pace", strength: "soft" }),
      requestConstraint({ type: "pace", value: 0.8 }, { id: "user-pace" }),
    ], assumptions: [] };
    const before = structuredClone(request);
    const effective = effectiveTripConstraints(request);
    expect(effective.find((c) => c.id === "profile")?.requirement).toEqual({ type: "mobility", maxTransfers: 0 });
    expect(effective.find((c) => c.id === "profile-pace")).toBeUndefined();
    expect(effective.find((c) => c.id === "user-pace")?.requirement).toEqual({ type: "pace", value: 0.8 });
    expect(request).toEqual(before);
  });
  it("keeps schedule independent and rejects a whole proposal with broken references", () => {
    const trip = requestTrip(undefined, [{ id: "item", type: "transport", title: "移動", detail: { status: "unresolved" }, schedule: { type: "day", date: "2026-09-22" } }]);
    const before = structuredClone(trip);
    const request = { constraints: [requestConstraint({ type: "dates", start: { earliest: "2026-09-25", latest: "2026-09-27" } })], assumptions: [] };
    const next = applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "条件変更", patches: [{ type: "request", request }] });
    expect(next.items).toEqual(trip.items);
    expect(() => applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "不正", patches: [{ type: "request", request }, { type: "request", request: assumedRequest("legacy") as TripRequest }, { type: "replace", itemId: "absent", item: trip.items[0]! }] })).toThrow();
    expect(trip).toEqual(before);
  });
  it("prioritizes explicit transport requirements over conflicting profile exclusions at the correct item scope", () => {
    const request: TripRequest = { constraints: [
      requestConstraint({ type: "mobility", excludedModes: ["rail"], maxTransfers: 1 }, { source: "profile", id: "profile", strength: "soft" }),
      requestConstraint({ type: "mobility", requiredModes: ["rail"] }, { scope: { type: "item", itemId: "outbound" } }),
    ], assumptions: [] };
    expect(effectiveTripConstraints(request, "outbound").find((c) => c.id === "profile")?.requirement).toEqual({ type: "mobility", maxTransfers: 1 });
    expect(effectiveTripConstraints(request, "return").find((c) => c.id === "profile")?.requirement).toEqual({ type: "mobility", excludedModes: ["rail"], maxTransfers: 1 });
  });
});
