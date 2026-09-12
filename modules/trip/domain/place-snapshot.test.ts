import { describe, expect, it } from "vitest";
import { createPlaceSnapshot, samePlaceIdentity, validatePlaceSnapshot, type PlaceSnapshot, type PlaceSnapshotRetention } from "./place-snapshot";

const at = "2026-09-12T08:00:00Z";
const manual = { origin: "manual" } as const;
const permission: PlaceSnapshotRetention = { origin: "provider", provider: "fixture", storage: "permitted",
  allowedFields: ["ref", "name", "address", "coordinate", "area", "timeZone", "capturedAt", "sources"] };
function providerPlace(): PlaceSnapshot {
  return { ref: { provider: "fixture", providerPlaceId: "opaque:001/A" }, name: "同名施設",
    address: "住所", area: "地域", timeZone: "Asia/Tokyo", capturedAt: at,
    coordinate: { longitude: 135, latitude: 35 },
    sources: [{ id: "runtime-id", kind: "place", provider: "fixture", sourceId: "catalog:001/A",
      sourceUrl: "https://example.com/places/001", attribution: "Fixture attribution", retrievedAt: at, confidence: "observed" }] };
}

describe("PlaceSnapshot persistence contract", () => {
  it("retains a name-only manual place without inventing identity, coordinates or verification", () => {
    const value = createPlaceSnapshot({ name: "公園", sources: [] }, manual);
    expect(value).toEqual({ name: "公園", sources: [] });
    expect(samePlaceIdentity(value.ref, value.ref)).toBe(false);
  });
  it("keeps opaque identity separate from display values and durable sources independent of runtime IDs", () => {
    const value = providerPlace(); const before = structuredClone(value);
    const result = createPlaceSnapshot(value, permission);
    expect(result).toEqual(value);
    expect(result.ref!.providerPlaceId).toBe("opaque:001/A");
    result.sources[0]!.id = "another-runtime";
    expect(result.sources[0]!.sourceId).toBe("catalog:001/A");
    expect(value).toEqual(before);
  });
  it("does not merge names, different providers or different opaque IDs", () => {
    const left = providerPlace();
    const right = { ...providerPlace(), ref: { provider: "fixture", providerPlaceId: "opaque:002/A" } };
    expect(left.name).toBe(right.name);
    expect(samePlaceIdentity(left.ref, right.ref)).toBe(false);
    expect(samePlaceIdentity(left.ref, { provider: "other", providerPlaceId: "opaque:001/A" })).toBe(false);
    expect(samePlaceIdentity(left.ref, { provider: "fixture", providerPlaceId: "opaque:001/A" })).toBe(true);
    expect(samePlaceIdentity({ provider: "fixture" }, { provider: "fixture" })).toBe(false);
    expect(samePlaceIdentity({ provider: "manual" }, { provider: "manual" })).toBe(false);
    expect(samePlaceIdentity({ provider: "fixture", canonicalKey: "resolved-1" }, { provider: "fixture", canonicalKey: "resolved-1" })).toBe(true);
    expect(samePlaceIdentity({ ...left.ref!, canonicalKey: "resolved-1" }, { ...right.ref, canonicalKey: "resolved-1" })).toBe(false);
  });
  it.each([[-180, -90], [180, 90], [0, 0]])("accepts coordinate boundaries %j / %j", (longitude, latitude) => {
    expect(createPlaceSnapshot({ name: "場所", coordinate: { longitude, latitude }, sources: [] }, manual).coordinate).toEqual({ longitude, latitude });
  });
  it.each([[181, 0], [-181, 0], [0, 91], [0, -91], [NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity]])("rejects invalid coordinate %j / %j", (longitude, latitude) => {
    expect(() => createPlaceSnapshot({ name: "場所", coordinate: { longitude, latitude }, sources: [] }, manual)).toThrow(/coordinate/);
  });
  it.each(["raw", "ref", "coordinate", "source"])("rejects unknown stored fields at %s", (where) => {
    const value = providerPlace();
    if (where === "raw") Object.assign(value, { raw: { providerPayload: true } });
    if (where === "ref") Object.assign(value.ref!, { token: "not-persistable" });
    if (where === "coordinate") Object.assign(value.coordinate!, { accuracy: 1 });
    if (where === "source") Object.assign(value.sources[0]!, { raw: true });
    expect(() => validatePlaceSnapshot(value)).toThrow(/Unknown field/);
  });
  it("constructs only permitted fields and never spreads raw provider response data", () => {
    const value = providerPlace();
    Object.assign(value, { raw: { secret: "excluded" }, images: ["image"], reviewAverage: 5, openingHours: "24h" });
    Object.assign(value.ref!, { raw: true });
    Object.assign(value.sources[0]!, { raw: true });
    Object.assign(value.coordinate!, { extra: true });
    const result = createPlaceSnapshot(value, { ...permission, allowedFields: ["ref", "name", "sources"] });
    expect(Object.keys(result)).toEqual(["name", "ref", "sources"]);
    expect(JSON.stringify(result)).not.toMatch(/raw|secret|images|reviewAverage|openingHours|coordinate/);
    expect(result.sources[0]!.attribution).toBe("Fixture attribution");
    expect(() => validatePlaceSnapshot(result)).not.toThrow();
  });
  it.each(["temporary", "unknown"] as const)("does not turn %s provider data into a permanent snapshot", (storage) => {
    expect(() => createPlaceSnapshot(providerPlace(), { ...permission, storage })).toThrow(/permission/);
  });
  it("requires a grant for the same provider, mandatory fields and durable evidence", () => {
    expect(() => createPlaceSnapshot(providerPlace(), { ...permission, provider: "other" })).toThrow(/permission/);
    expect(() => createPlaceSnapshot(providerPlace(), { ...permission, allowedFields: ["name"] })).toThrow(/permission/);
    const value = providerPlace();
    delete value.sources[0]!.sourceId; delete value.sources[0]!.sourceUrl;
    expect(() => createPlaceSnapshot(value, permission)).toThrow(/durable/);
  });
  it("cannot evade provider retention by relabeling input or permission as manual", () => {
    expect(() => createPlaceSnapshot(providerPlace(), manual)).toThrow(/manual/);
    const value = { ...providerPlace(), ref: { provider: "manual" } };
    expect(() => validatePlaceSnapshot(value)).toThrow(/manual/);
    expect(() => createPlaceSnapshot(value, manual)).toThrow(/manual/);
  });
  it.each(["timeZone", "capturedAt", "name", "providerPlaceId", "sourceUrl"])("rejects invalid %s", (field) => {
    const value = providerPlace();
    if (field === "timeZone") Object.assign(value, { timeZone: "unknown/zone" });
    if (field === "capturedAt") Object.assign(value, { capturedAt: "2025-01-01T00:00:00Z" });
    if (field === "name") Object.assign(value, { name: " " });
    if (field === "providerPlaceId") Object.assign(value.ref!, { providerPlaceId: " " });
    if (field === "sourceUrl") value.sources[0]!.sourceUrl = "https://example.com/api?token=not-persistable";
    expect(() => createPlaceSnapshot(value, permission)).toThrow();
  });
});
