import { describe, expect, it } from "vitest";
import { evaluateTripHardConstraints } from "./trip-constraint-evaluation";
import { requestAt, requestRailItem, requestConstraint, requestTrip, assumedRequest } from "./trip-request.fixture";
import type { TripRequirement } from "./trip-requirement";
import type { ItinerarySchedule } from "./itinerary-schedule";

function evaluate(requirement: TripRequirement, item = requestRailItem()) {
  return evaluateTripHardConstraints(requestTrip({ constraints: [requestConstraint(requirement)], assumptions: [] }, [item]))[0]!.status;
}
describe("minimal hard constraint evaluation", () => {
  it.each([
    [{ type: "mobility", maxTransfers: 1 }, "satisfied"],
    [{ type: "mobility", maxTransfers: 0 }, "violated"],
    [{ type: "mobility", maxTravelMinutes: 100 }, "satisfied"],
    [{ type: "mobility", maxTravelMinutes: 99 }, "violated"],
    [{ type: "mobility", modes: ["rail", "bus"] }, "satisfied"],
    [{ type: "mobility", modes: ["bus"] }, "violated"],
    [{ type: "mobility", requiredModes: ["rail"] }, "satisfied"],
    [{ type: "mobility", excludedModes: ["rail"] }, "violated"],
    [{ type: "mobility", excludedTrainNumbers: ["1M"] }, "violated"],
    [{ type: "mobility", excludedServiceUids: ["s1"] }, "violated"],
    [{ type: "mobility", requiredTrainNumbers: ["1M", "2M"] }, "satisfied"],
    [{ type: "mobility", requiredTrainNumbers: ["3M"] }, "violated"],
    [{ type: "mobility", transferPace: "standard" }, "satisfied"],
    [{ type: "mobility", transferPace: "relaxed" }, "unknown"],
    [{ type: "mobility", requiredServiceTypes: ["普通"] }, "unknown"],
    [{ type: "mobility", maxTransfers: 2, carAvailable: true }, "unknown"],
    [{ type: "experience", intent: "must", text: "静かでリラックスできる" }, "unknown"],
  ] as const)("evaluates only recorded planned facts: %j -> %s", (requirement, status) => {
    expect(evaluate(requirement as TripRequirement)).toBe(status);
  });
  it("compares arrival/departure instants with verified place identity, not just a matching name", () => {
    const item = requestRailItem();
    if (item.detail.status !== "selected" || item.detail.mode !== "rail") throw new Error("fixture");
    const first = item.detail.journey.legs[0]!;
    const last = item.detail.journey.legs.at(-1)!;
    // A provider-resolved identity fixture; production timetable name-only snapshots remain unknown.
    Object.assign(first.origin, { ref: { provider: "timetable", providerPlaceId: "station-a" } });
    Object.assign(last.destination, { ref: { provider: "timetable", providerPlaceId: "station-c" } });
    const before = structuredClone(item);
    expect(evaluate({ type: "arrive_by", at: requestAt, place: last.destination }, item)).toBe("satisfied");
    expect(evaluate({ type: "arrive_by", at: { ...requestAt, at: "2026-09-13T10:30:00+09:00" }, place: last.destination }, item)).toBe("violated");
    expect(evaluate({ type: "depart_after", at: first.scheduledDeparture, place: first.origin }, item)).toBe("satisfied");
    expect(evaluate({ type: "depart_after", at: requestAt, place: first.origin }, item)).toBe("violated");
    expect(evaluate({ type: "arrive_by", at: requestAt, place: { name: last.destination.name, sources: [] } }, item)).toBe("unknown");
    expect(evaluate({ type: "arrive_by", at: requestAt, place: { ...last.destination, ref: { provider: "timetable", providerPlaceId: "another-station" } } }, item)).toBe("unknown");
    expect(item).toEqual(before);
  });
  it.each([
    [{ type: "day", date: "2026-09-21" }, "satisfied"],
    [{ type: "day", date: "2026-09-25" }, "violated"],
    [{ type: "window", earliestStart: { at: "2026-09-21T09:00:00+09:00", timeZone: "Asia/Tokyo" }, latestEnd: { at: "2026-09-23T18:00:00+09:00", timeZone: "Asia/Tokyo" } }, "satisfied"],
    [{ type: "window", earliestStart: { at: "2026-09-20T09:00:00+09:00", timeZone: "Asia/Tokyo" }, latestEnd: { at: "2026-09-22T18:00:00+09:00", timeZone: "Asia/Tokyo" } }, "unknown"],
    [{ type: "unscheduled" }, "unknown"],
  ] as const)("evaluates date precision without selecting a date: %j", (schedule, status) => {
    const item = { ...requestRailItem(), schedule: schedule as ItinerarySchedule, detail: { status: "unresolved" as const } };
    expect(evaluate({ type: "dates", start: { earliest: "2026-09-21", latest: "2026-09-23" } }, item)).toBe(status);
  });
  it("does not assume a zone or a missing end, and compares in an explicit requested zone", () => {
    const base = { ...requestRailItem(), detail: { status: "unresolved" as const } };
    const date = { earliest: "2026-09-13", latest: "2026-09-13" };
    expect(evaluate({ type: "dates", start: date, timeZone: "Asia/Tokyo" }, { ...base, schedule: { type: "day", date: date.earliest } })).toBe("unknown");
    expect(evaluate({ type: "dates", start: date, end: date }, { ...base, schedule: { type: "fixed", startAt: requestAt } })).toBe("unknown");
    expect(evaluate({ type: "dates", start: date, timeZone: "Asia/Tokyo" }, { ...base, schedule: { type: "fixed", startAt: { at: "2026-09-12T20:00:00-07:00", timeZone: "America/Los_Angeles" } } })).toBe("satisfied");
  });
  it("does not report unknown facts or unconfirmed hard assumptions as success", () => {
    expect(evaluate({ type: "mobility", maxTransfers: 2 }, { ...requestRailItem(), detail: { status: "unresolved" }, schedule: { type: "unscheduled" } })).toBe("unknown");
    const request = assumedRequest();
    expect(evaluateTripHardConstraints(requestTrip(request))).toEqual([{ constraintId: "condition", status: "unknown", reasonCode: "unconfirmed_assumption" }]);
    expect(evaluateTripHardConstraints(requestTrip({ ...request, assumptions: request.assumptions.map((a) => ({ ...a, status: "rejected" })) }))).toEqual([]);
    expect(evaluateTripHardConstraints(requestTrip({ constraints: [requestConstraint({ type: "mobility", maxTransfers: 1 }, { strength: "soft" })], assumptions: [] }))).toEqual([]);
  });
  it("keeps per-item limits scoped and uses scheduled rather than delayed time", () => {
    const item = requestRailItem();
    const other = { ...requestRailItem(), id: "return" };
    const request = { constraints: [requestConstraint({ type: "mobility", maxTravelMinutes: 100 }), requestConstraint({ type: "mobility", maxTransfers: 0 }, { id: "return-only", scope: { type: "item" as const, itemId: "return" } })], assumptions: [] };
    expect(evaluateTripHardConstraints(requestTrip(request, [item, other])).map((r) => r.status)).toEqual(["satisfied", "violated"]);
  });
  it("does not report a profile violation when the user explicitly overrode it for one item", () => {
    const request = { constraints: [
      requestConstraint({ type: "mobility", maxTransfers: 0 }, { source: "profile", id: "profile" }),
      requestConstraint({ type: "mobility", maxTransfers: 2 }, { scope: { type: "item" as const, itemId: "rail" } }),
    ], assumptions: [] };
    const results = evaluateTripHardConstraints(requestTrip(request, [requestRailItem()]));
    expect(results.map((r) => r.status)).toEqual(["unknown", "satisfied"]);
  });
});
