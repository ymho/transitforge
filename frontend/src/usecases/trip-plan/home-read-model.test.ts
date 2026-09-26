import { expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { classifyTrips } from "@raiquora/trip/trip-adoption";
import { homeReadModel } from "./home-read-model";

const now = new Date("2026-09-18T00:00:00Z");
const trip = { ...createTrip("45300000-0000-4000-8000-000000000001", "旅", now.toISOString(), [
  { id: "walk", title: "散策", type: "activity", category: "free-time", schedule: { type: "day", date: "2026-10-20", timeZone: "Asia/Tokyo" } },
]), adoption: { confirmedAt: now.toISOString() } };

it("uses the shared classification without mutating the Trip", () => {
  const before = structuredClone(trip);
  const result = homeReadModel({ state: "available", trips: [trip] }, now);
  expect(result.trips).toEqual(classifyTrips([trip], { now: () => now }));
  expect(trip).toEqual(before);
});
it("does not show cached trips after an unavailable read", () => {
  expect(homeReadModel({ state: "unavailable", trips: [trip] }, now).trips).toEqual([]);
});
