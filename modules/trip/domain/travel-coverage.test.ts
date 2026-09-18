import { describe, expect, it } from "vitest";
import { assessRailCoverage, assessPlaceCoverage, validateTravelCoverage } from "./travel-coverage";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import type { PlaceSnapshot } from "./place-snapshot";
import type { GroundAccessRoute } from "./ground-access";
import type { ExternalTravelInformation } from "./external-travel-information";

describe("loaded coverage, not place-name policy", () => {
  it("rejects malformed coverage projections rather than accepting model-shaped proof", () => {
    const f = railSelectionFixture(), coverage = assessRailCoverage(f.candidate, f.inputs, f.selectedAt);
    expect(() => validateTravelCoverage(coverage)).not.toThrow();
    for (const invalid of [{ ...coverage, reason: "looks-near" }, { ...coverage, raw: {} },
      { ...coverage, inputVersions: [{ sourceId: "source", contentDigest: "" }] },
      { ...coverage, inputVersions: [{ sourceId: "source", contentDigest: "digest", raw: {} }] }]) {
      expect(() => validateTravelCoverage(invalid as typeof coverage)).toThrow();
    }
  });
  it("uses actual dated verified service and current digest, not a station list alone", () => {
    const f = railSelectionFixture();
    expect(assessRailCoverage(f.candidate, f.inputs, f.selectedAt).status).toBe("supported");
    f.inputs[0]!.index.trains = [];
    expect(assessRailCoverage(f.candidate, f.inputs, f.selectedAt).status).toBe("unresolved");
  });
  it.each(["missing", "representative", "changed", "stale", "catalog", "outside", "ambiguous"])("distinguishes %s", (mode) => {
    const f = railSelectionFixture(), input = f.inputs[0]!;
    const expected = { missing: "data-unavailable", representative: "unresolved", changed: "unresolved", stale: "data-unavailable",
      catalog: "data-unavailable", outside: "outside-coverage", ambiguous: "unresolved" };
    if (mode === "missing") f.inputs = [];
    if (mode === "representative") { delete input.index.service_date; input.index.timetable_kind = "weekday"; }
    if (mode === "changed") input.contentDigest = "updated";
    if (mode === "stale") input.evidence.validUntil = "2020-01-01T00:00:00Z";
    if (mode === "catalog") delete input.index.station_line_catalog;
    if (mode === "outside") input.index.station_line_catalog!.lines[0]!.stations.pop();
    if (mode === "ambiguous") input.index.station_line_catalog!.lines[0]!.stations.push({ name: "A", coordinate: [140, 40] });
    expect(assessRailCoverage(f.candidate, f.inputs, f.selectedAt).status).toBe(expected[mode as keyof typeof expected]);
  });
  it("catalog boundary follows loaded data and never invokes a geographic blacklist", () => {
    const f = railSelectionFixture(), catalog = f.inputs[0]!.index.station_line_catalog!;
    catalog.lines[0]!.stations.push({ name: "C", coordinate: [135.2, 35] });
    expect(assessRailCoverage(f.candidate, f.inputs, f.selectedAt).status).toBe("supported");
    expect(assessRailCoverage(undefined, f.inputs, f.selectedAt)).toMatchObject({ status: "unresolved", reason: "missing-candidate" });
    const before = structuredClone(f);
    assessRailCoverage(f.candidate, f.inputs, f.selectedAt);
    expect(f).toEqual(before);
  });
  it("requires a fresh, identity-bound ground route rather than proximity or same facility name", () => {
    const f = railSelectionFixture();
    const evidence = { id: "access", sourceId: "route-1", kind: "ground-access" as const, provider: "fixture",
      retrievedAt: "2026-09-12T07:58:00Z", validUntil: "2026-09-13T07:58:00Z", confidence: "observed" as const };
    const place: PlaceSnapshot = { name: "施設", ref: { provider: "fixture", providerPlaceId: "place-1" },
      coordinate: { longitude: 135.201, latitude: 35.001 }, sources: [{ ...evidence, kind: "place" }] };
    const station = f.inputs[0]!.index.station_line_catalog!.lines[0]!.stations[2]!;
    const access: ExternalTravelInformation<GroundAccessRoute> = { status: "available", freshness: "fresh", evidence: [evidence], data: {
      origin: { name: "C", entityId: "station-c", longitude: 135.2, latitude: 35 },
      destination: { name: "施設", entityId: "place-1", longitude: 135.201, latitude: 35.001 },
      mode: "walking", durationMinutes: 5, distanceMeters: 300, geometry: [],
    } };
    const assess = () => assessPlaceCoverage(place, station, f.candidate, f.inputs, access, f.selectedAt);
    expect(assess()).toMatchObject({ status: "supported", reason: "verified-access" });
    expect(assessPlaceCoverage(place, station, f.candidate, f.inputs, undefined, f.selectedAt).status).toBe("unresolved");
    access.data!.destination.entityId = "different-place-same-name";
    expect(assess().status).toBe("unresolved");
    access.data!.destination.entityId = "place-1";
    access.freshness = "stale";
    expect(assess().status).toBe("unresolved");
  });
});
