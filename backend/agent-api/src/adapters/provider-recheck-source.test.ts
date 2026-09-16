import { describe, expect, it, vi } from "vitest";
import { areaInput, areaNow, weatherFixture } from "../../../../modules/trip/domain/area-trip-impact.fixture.js";
import { hazardInformation } from "../../../../modules/trip/domain/hazard-alert.fixture.js";
import { projectTripWatches } from "@raiquora/trip/trip-watch";
import type { PlaceSnapshot } from "@raiquora/trip/place-snapshot";
import { TrustedRecheckTargetResolver, weatherPlaceSubject } from "./recheck-target-resolver.js";
import { parseRecheckTargetCatalog } from "./s3-recheck-target-catalog.js";
import { ProviderRecheckSource } from "./provider-recheck-source.js";
import { OpenMeteoWeatherProvider } from "./open-meteo-weather-provider.js";
import { JmaHazardAlertProvider } from "./jma-hazard-alert-provider.js";

const place: PlaceSnapshot = { name: "合成の施設（区域名を推測しない）", ref: { provider: "synthetic", providerPlaceId: "opaque-1" },
  coordinate: { longitude: 135.5, latitude: 34.69 }, timeZone: "Asia/Tokyo", capturedAt: areaNow,
  sources: [{ id: "place-source", kind: "place", provider: "synthetic", sourceId: "opaque-1", confidence: "observed", retrievedAt: areaNow }] };
const binding = { ref: place.ref!, area: "大阪府", sources: structuredClone(place.sources) };
function setup() {
  const base = areaInput().trip, trip = { ...base, items: base.items.map((item) => ({ ...item, place })) };
  const targets = new TrustedRecheckTargetResolver({ read: async () => [binding] });
  const weather = { searchTarget: vi.fn(async (target: Parameters<OpenMeteoWeatherProvider["searchTarget"]>[0]) => {
    const f = weatherFixture(); return { ...f.result, data: { ...f.result.data!, locationName: target.location.name } };
  }) };
  const hazard = { search: vi.fn(async () => hazardInformation()) }, rail = { event: vi.fn() };
  const source = new ProviderRecheckSource(targets, weather, hazard, rail, () => new Date(areaNow));
  return { trip, targets, weather, hazard, source };
}
describe("trusted production targets and existing Provider/Event seams", () => {
  it("resolves coordinate from saved evidence and hazard from opaque identity, not title/area", async () => {
    const f = setup(), resolved = await f.targets.resolve(f.trip);
    expect(resolved.unresolved).toBe(false); expect(resolved.scopes).toHaveLength(2);
    for (const watch of projectTripWatches(f.trip, resolved.scopes)) {
      const events = await f.source.events(f.trip, watch, Date.parse(areaNow));
      expect(events).toHaveLength(1); expect(events[0]!.subject).toEqual(watch.subject);
    }
    expect(f.weather.searchTarget.mock.calls[0]![0].location).toEqual({ name: place.name, ...place.coordinate });
    expect(f.hazard.search).toHaveBeenCalledWith({ area: "大阪府", limit: 12 });
  });
  it("ambiguous bindings and manual/name-only place cannot be promoted to verified targets", async () => {
    const f = setup(); const ambiguous = new TrustedRecheckTargetResolver({ read: async () => [binding, { ...binding, area: "別区域" }] });
    expect((await ambiguous.resolve(f.trip)).unresolved).toBe(true);
    const watch = projectTripWatches(f.trip, [{ itineraryItemId: "activity", subject: { type: "hazard-area", area: "大阪府" } }])[0]!;
    await expect(ambiguous.hazard(f.trip, watch)).rejects.toMatchObject({ code: "target_unknown" });
    expect(weatherPlaceSubject({ name: "大阪府", sources: [], coordinate: place.coordinate, timeZone: place.timeZone })).toBeUndefined();
    const other = new TrustedRecheckTargetResolver({ read: async () => [{ ...binding, ref: { provider: "synthetic", providerPlaceId: "another-id" } }] });
    expect((await other.resolve(f.trip)).unresolved).toBe(true);
  });
  it("catalog failure does not return empty desired set that would deactivate trusted Watches", async () => {
    const f = setup(), targets = new TrustedRecheckTargetResolver({ read: async () => { throw new Error("S3-unavailable"); } });
    await expect(targets.resolve(f.trip)).rejects.toThrow();
  });
  it("validates catalog allowlist, provenance and opaque IDs", () => {
    expect(parseRecheckTargetCatalog({ schemaVersion: 1, bindings: [binding] })).toEqual([binding]);
    for (const entry of [{ ...binding, ownerSubject: "forged" }, { ...binding, sources: [] }, { ...binding, ref: { provider: "manual" } }]) {
      expect(() => parseRecheckTargetCatalog({ schemaVersion: 1, bindings: [entry] })).toThrow();
    }
  });
  it("long range is actually fetched in bounded chunks, not sent to mapper as one oversized result", async () => {
    const f = setup(); f.trip.items = f.trip.items.map((item) => ({ ...item, schedule: { type: "day", date: "2026-09-12", endDate: "2026-10-01", timeZone: "Asia/Tokyo" } }));
    f.weather.searchTarget.mockImplementation(async (target) => {
      const base = weatherFixture().result;
      return { ...base, data: { ...base.data!, locationName: target.location.name,
        hourly: [{ ...base.data!.hourly[0]!, time: `${target.query.startDate}T17:00` }] } };
    });
    const scopes = await f.targets.resolve(f.trip), watch = projectTripWatches(f.trip, scopes.scopes).find((w) => w.subject.type === "weather-area")!;
    expect(await f.source.events(f.trip, watch, Date.parse(areaNow))).toHaveLength(3);
    expect(f.weather.searchTarget.mock.calls.map(([target]) => [target.query.startDate, target.query.endDate])).toEqual([
      ["2026-09-12", "2026-09-17"], ["2026-09-18", "2026-09-23"], ["2026-09-24", "2026-09-27"]]);
  });
  it("horizon outside never invokes the weather provider; failures never become safe Events", async () => {
    const f = setup(); f.trip.items = f.trip.items.map((item) => ({ ...item, schedule: { type: "day", date: "2026-12-01", timeZone: "Asia/Tokyo" } }));
    const resolved = await f.targets.resolve(f.trip), watch = projectTripWatches(f.trip, resolved.scopes).find((w) => w.subject.type === "weather-area")!;
    await expect(f.source.events(f.trip, watch, Date.parse(areaNow))).rejects.toMatchObject({ code: "horizon" });
    expect(f.weather.searchTarget).not.toHaveBeenCalled();
  });
  it("coordinate forecast path bypasses geocoding and uses a durable query-free source citation", async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ timezone: "Asia/Tokyo",
      hourly: { time: ["2026-09-12T17:00"], temperature_2m: [25], precipitation_probability: [80], precipitation: [3], weather_code: [61] },
      daily: { time: ["2026-09-12"], temperature_2m_min: [20], temperature_2m_max: [28], precipitation_probability_max: [80], precipitation_sum: [3], weather_code: [61] } })));
    const result = await new OpenMeteoWeatherProvider({ fetch }, () => new Date(areaNow)).searchTarget(weatherFixture().target);
    expect(result.status).toBe("available"); expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("geocoding");
    expect(result.evidence[0]!.sourceUrl).toBe("https://api.open-meteo.com/v1/forecast");
  });
  it.each(["weather", "hazard"])("%s preserves timeout and rate-limit classification", async (kind) => {
    const timeout = { fetch: async () => { throw Object.assign(new Error(), { name: "TimeoutError" }); } };
    const limited = { fetch: async () => new Response("", { status: 429 }) };
    for (const [http, code] of [[timeout, "timeout"], [limited, "rate_limited"]] as const) {
      const result = kind === "weather" ? await new OpenMeteoWeatherProvider(http, () => new Date(areaNow)).searchTarget(weatherFixture().target)
        : await new JmaHazardAlertProvider(http).search({ area: "大阪府" });
      expect(result.failure?.code).toBe(code); expect(result.data).toBeUndefined();
    }
  });
});
