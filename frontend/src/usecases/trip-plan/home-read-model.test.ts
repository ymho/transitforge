import { expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { classifyTrips } from "@raiquora/trip/trip-adoption";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";
import { assessTravelCandidate } from "@raiquora/trip/assess-travel-candidate";
import { homeReadModel } from "./home-read-model";

const now = new Date("2026-09-18T00:00:00Z");
const trip = { ...createTrip("45300000-0000-4000-8000-000000000001", "旅", now.toISOString(), [
  { id: "walk", title: "散策", type: "activity", category: "free-time", schedule: { type: "day", date: "2026-10-20", timeZone: "Asia/Tokyo" } },
]), adoption: { confirmedAt: now.toISOString() } };
it("uses the shared classification without manufacturing a booking or mutating the Trip", () => {
  const before = structuredClone(trip);
  const result = homeReadModel({ state: "available", trips: [trip], candidates: [] }, now);
  expect(result.trips).toEqual(classifyTrips([trip], { now: () => now })); expect(result.next?.trip.id).toBe(trip.id);
  expect(result.readiness).toBeUndefined(); expect(trip).toEqual(before);
});
it("does not show cached trips as current after an unavailable read", () => {
  const result = homeReadModel({ state: "unavailable", trips: [trip], candidates: [] }, now);
  expect(result.trips).toEqual([]); expect(result.next).toBeUndefined();
});
it("uses validated candidate assessment coverage, not a Home-specific region rule", () => {
  const c = createTravelCandidate({ id: "candidate" });
  const assessment = assessTravelCandidate(trip, c, { candidateId: c.id }, now.toISOString());
  const input = { state: "available" as const, trips: [], candidates: [{ id: c.id, title: "候補", assessment }] };
  for (const status of ["unresolved", "outside-coverage", "data-unavailable"] as const) {
    assessment.serviceCoverage = { policyVersion: "loaded-timetable-access-v1", status, reason: "missing-candidate", inputVersions: [] };
    expect(homeReadModel(input, now).candidates).toHaveLength(0);
  }
  assessment.serviceCoverage = { policyVersion: "loaded-timetable-access-v1", status: "supported", reason: "verified-route", inputVersions: [] };
  expect(homeReadModel(input, now).candidates).toHaveLength(1);
  expect(homeReadModel({ ...input, candidates: [{ id: "wrong", title: "候補", assessment }] }, now).candidates).toHaveLength(0);
});
