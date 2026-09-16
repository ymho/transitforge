import { describe, expect, it } from "vitest";
import { areaInput, areaNow, areaWeatherEvent } from "./area-trip-impact.fixture";
import { nextRecheckAt, recheckForecastRanges, recheckIdentity, recheckEnvelope } from "./trip-recheck";

const watch = areaInput().watches[0]!, now = Date.parse(areaNow);
describe("versioned shared recheck policy", () => {
  it("does not fetch weeks outside horizon; becomes due inside it", () => {
    const early = now - 30 * 86_400_000, due = nextRecheckAt(watch, early)!;
    expect(due).toBeGreaterThan(early); expect(nextRecheckAt(watch, due)).toBe(due);
    expect(nextRecheckAt(watch, now)).toBe(now);
  });
  it("uses stable revision/kind/scope identity and distinct revisions", () => {
    const id = recheckIdentity(watch.tripId, 1, "weather", watch.id);
    expect(id).toBe(recheckIdentity(watch.tripId, 1, "weather", watch.id));
    expect(id).not.toBe(recheckIdentity(watch.tripId, 2, "weather", watch.id));
    expect(id).not.toBe(recheckIdentity(watch.tripId, 1, "hazard", watch.id));
  });
  it("splits a long stay into bounded chunks inside the provider horizon, without changing day precision", () => {
    const schedule = { type: "day" as const, date: "2026-09-12", endDate: "2026-10-15", timeZone: "Asia/Tokyo" };
    const before = structuredClone(schedule), chunks = recheckForecastRanges(schedule, "Asia/Tokyo", now);
    expect(chunks).toEqual([{ startDate: "2026-09-12", endDate: "2026-09-17" }, { startDate: "2026-09-18", endDate: "2026-09-23" }, { startDate: "2026-09-24", endDate: "2026-09-27" }]);
    expect(schedule).toEqual(before);
  });
  it("clamps old dates, returns no forecast for unknown/future-out-of-horizon schedules", () => {
    expect(recheckForecastRanges({ type: "unscheduled" }, "Asia/Tokyo", now)).toEqual([]);
    expect(recheckForecastRanges({ type: "day", date: "2026-12-01" }, "Asia/Tokyo", now)).toEqual([]);
    expect(recheckForecastRanges({ type: "day", date: "2026-09-01", endDate: "2026-09-14" }, "Asia/Tokyo", now)).toEqual([{ startDate: "2026-09-12", endDate: "2026-09-13" }]);
  });
  it("has bounded cadence and stops after the envelope", () => {
    expect(nextRecheckAt(watch, now, true)).toBe(now + 30 * 60_000);
    expect(nextRecheckAt(watch, recheckEnvelope(watch.activeWindow)!.end + 1)).toBeUndefined();
    expect(areaWeatherEvent().subject).toEqual(watch.subject);
  });
});
