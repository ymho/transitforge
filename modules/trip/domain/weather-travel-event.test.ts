import { describe, it, expect } from "vitest";
import { areaNow, weatherFixture } from "./area-trip-impact.fixture";
import { weatherTravelEvent } from "./weather-travel-event";
import { forecastHourInstant } from "./weather-event-fact";
import { travelEventId, validateTravelEvent } from "./travel-event";

describe("bounded weather event normalization", () => {
  it("normalizes provider local hours using explicit timezone and excludes raw/daily fields", () => {
    const f = weatherFixture(); Object.assign(f.result.data!, { raw: "private-payload" }); Object.assign(f.result.data!.hourly[0]!, { windSpeed: 99 });
    const event = weatherTravelEvent(f.target, f.result, areaNow);
    expect(event.fact).toMatchObject({ precipitationPeriod: "preceding-hour", timezone: "Asia/Tokyo", location: f.target.location, forecast: [{ at: "2026-09-12T08:00:00.000Z" }, {}, {}, {}] });
    expect(JSON.stringify(event)).not.toMatch(/private-payload|windSpeed|alertsAvailable|daily/u); expect(event.freshness).toBe("fresh");
  });
  it("same semantic state preserves ID when only retrieval/evidence IDs change", () => {
    const f = weatherFixture(), first = weatherTravelEvent(f.target, f.result, areaNow);
    f.result.evidence[0]!.id = "next"; f.result.evidence[0]!.retrievedAt = "2026-09-12T08:01:00Z";
    expect(weatherTravelEvent(f.target, f.result, "2026-09-12T08:01:00Z").id).toBe(first.id);
    f.result.data!.hourly[0]!.precipitationMillimeters = 4;
    expect(weatherTravelEvent(f.target, f.result, "2026-09-12T08:01:00Z").id).not.toBe(first.id);
  });
  it.each(["duplicate", "out-of-order", "range", "bound", "timezone", "coordinate", "location", "probability", "negative-rain", "temperature", "code", "invalid-time"])("rejects %s", (mode) => {
    const f = weatherFixture(), h = f.result.data!.hourly;
    if (mode === "duplicate") h[1] = { ...h[0]! };
    if (mode === "out-of-order") h.reverse();
    if (mode === "range") h[0]!.time = "2026-09-11T23:00";
    if (mode === "bound") f.result.data!.hourly = Array.from({ length: 169 }, () => h[0]!);
    if (mode === "timezone") f.result.data!.timezone = "Europe/Paris";
    if (mode === "coordinate") f.result.data!.latitude = 0;
    if (mode === "location") f.result.data!.locationName = "別の同名候補";
    if (mode === "probability") h[0]!.precipitationProbabilityPercent = 101;
    if (mode === "negative-rain") h[0]!.precipitationMillimeters = -1;
    if (mode === "temperature") h[0]!.temperatureCelsius = NaN;
    if (mode === "code") h[0]!.weatherCode = 999;
    if (mode === "invalid-time") h[0]!.time = "2026-09-12T25:00";
    expect(() => weatherTravelEvent(f.target, f.result, areaNow)).toThrow();
  });
  it("refuses DST gaps/folds without explicit offsets; explicit disambiguation and fractional zones work", () => {
    expect(() => forecastHourInstant("2026-11-01T01:00", "America/New_York")).toThrow();
    expect(() => forecastHourInstant("2026-03-08T02:00", "America/New_York")).toThrow();
    expect(forecastHourInstant("2026-11-01T01:00:00-04:00", "America/New_York")).toBe("2026-11-01T05:00:00.000Z");
    expect(forecastHourInstant("2026-09-12T17:00", "Asia/Kathmandu")).toBe("2026-09-12T11:15:00.000Z");
    expect(() => forecastHourInstant("2026-09-12T17:00", "invalid/zone")).toThrow();
  });
  it("preserves unavailable/empty/stale and rejects untrusted Evidence", () => {
    const f = weatherFixture();
    expect(weatherTravelEvent(f.target, { status: "unavailable", freshness: "unknown", evidence: [] }, areaNow).fact.status).toBe("unavailable");
    f.result.data!.hourly = []; expect(weatherTravelEvent(f.target, f.result, areaNow).fact.status).toBe("unknown");
    const g = weatherFixture(); g.result.evidence[0]!.validUntil = "2026-09-12T07:59:00Z";
    expect(weatherTravelEvent(g.target, g.result, areaNow).freshness).toBe("stale");
    g.result.evidence[0]!.retrievedAt = "2026-09-12T08:01:00Z";
    expect(weatherTravelEvent(g.target, g.result, areaNow).fact.status).toBe("unknown");
  });
  it("strict Event contract rejects raw/unknown properties, including nested measurements", () => {
    const f = weatherFixture(), event = weatherTravelEvent(f.target, f.result, areaNow);
    if (event.kind !== "weather" || event.fact.status !== "observed") throw new Error();
    Object.assign(event.fact.forecast[0]!, { raw: true });
    expect(() => validateTravelEvent({ ...event, id: travelEventId(event) })).toThrow();
  });
  it("accepts a bounded seven-day forecast with a bounded semantic identity", () => {
    const f = weatherFixture(); f.target.query.endDate = "2026-09-18";
    const sample = f.result.data!.hourly[0]!;
    f.result.data!.hourly = Array.from({ length: 168 }, (_, i) => ({ ...sample,
      time: new Date(Date.parse("2026-09-12T00:00:00Z") + i * 3600000).toISOString().slice(0, 16) }));
    const event = weatherTravelEvent(f.target, f.result, areaNow);
    expect(event.id.length).toBeLessThan(24000); expect(event.fact.status).toBe("observed");
  });
});
