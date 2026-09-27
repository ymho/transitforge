import { describe, expect, it } from "vitest";
import { ageDecades, schoolStages, parsePartyCohorts, resolvePartyCohorts, assertPartyScopeCurrent,
  projectPartyAtScope, type PartyScopeCatalog, type PartyCohortInput } from "./party-cohorts";

const catalog: PartyScopeCatalog = { tripId: "known-trip", tripRevision: 4,
  days: ["day-a", "day-b", "day-c"].map((id, index) => ({ id, label: `${index + 1}日目` })),
  segments: [{ id: "known-outbound", label: "往路" }, { id: "known-return", label: "帰路" }] };
const university: PartyCohortInput = { count: 1, schoolStage: "university", ageDecade: "twenties",
  membership: "baseline", scope: { kind: "whole_trip" } };

describe("anonymous current-trip cohorts", () => {
  it("keeps school stage and decade independent, without exact age or a fare class", () => {
    expect(resolvePartyCohorts([university])).toEqual([university]);
    for (const schoolStage of schoolStages) for (const ageDecade of ageDecades) {
      const [cohort] = resolvePartyCohorts([{ ...university, schoolStage, ageDecade }]);
      expect(cohort).toEqual({ ...university, schoolStage, ageDecade });
      expect(cohort).not.toHaveProperty("exactAge");
    }
  });
  it("accepts explicit exact age, rejects contradictory decade and all identity/qualification fields", () => {
    expect(resolvePartyCohorts([{ ...university, exactAge: 21 }])[0]?.exactAge).toBe(21);
    expect(() => resolvePartyCohorts([{ ...university, exactAge: 18 }])).toThrow("invalid_cohorts");
    for (const additional of [{ name: "person" }, { participantId: "id" }, { childFare: true }, { role: "child" }, { senior: true }])
      expect(() => parsePartyCohorts([{ ...university, ...additional }])).toThrow("invalid_cohorts");
    for (const count of [0, 21, 1.5, NaN]) expect(() => parsePartyCohorts([{ ...university, count }])).toThrow("invalid_cohorts");
    expect(() => parsePartyCohorts([{ ...university, count: 11 }, { ...university, count: 10 }])).toThrow("invalid_cohorts");
  });
  it("canonicalizes unordered anonymous groups without collapsing separate axes", () => {
    const other = { ...university, schoolStage: "elementary" as const, ageDecade: undefined };
    expect(resolvePartyCohorts([university, other])).toEqual(resolvePartyCohorts([other, university]));
  });
  it("resolves ordinal days and segments only from a known Trip snapshot", () => {
    expect(resolvePartyCohorts([{ ...university, membership: "additional", scope: { kind: "logical_days", fromDay: 2 } }], catalog)[0]?.scope)
      .toEqual({ kind: "logical_days", tripId: catalog.tripId, tripRevision: 4, dayIds: ["day-b", "day-c"] });
    expect(resolvePartyCohorts([{ ...university, scope: { kind: "segment", segmentNumber: 2 } }], catalog)[0]?.scope)
      .toEqual({ kind: "segment", tripId: catalog.tripId, tripRevision: 4, segmentId: "known-return" });
    expect(() => resolvePartyCohorts([{ ...university, scope: { kind: "logical_days", fromDay: 2 } }])).toThrow("scope_required");
    for (const scope of [{ kind: "logical_days", fromDay: 4 }, { kind: "logical_days", fromDay: 3, toDay: 2 },
      { kind: "logical_days" }, { kind: "segment", segmentNumber: 3 }] as const)
      expect(() => resolvePartyCohorts([{ ...university, scope }], catalog)).toThrow("scope_not_found");
    expect(() => resolvePartyCohorts([{ ...university, membership: "additional" }])).toThrow("invalid_cohorts");
  });
  it("preserves baseline and accounts for joining and leaving only in the requested days", () => {
    const cohorts = resolvePartyCohorts([
      { count: 1, schoolStage: "elementary", membership: "baseline", scope: { kind: "logical_days", toDay: 2 } },
      { ...university, membership: "additional", scope: { kind: "logical_days", fromDay: 2 } },
    ], catalog);
    const before = structuredClone(cohorts);
    expect(catalog.days.map(day => projectPartyAtScope(cohorts, 3, catalog, { kind: "logical_day", dayId: day.id })))
      .toMatchObject([{ status: "known", people: 3, unspecifiedBaseline: 2 }, { status: "known", people: 4 }, { status: "known", people: 3 }]);
    expect(cohorts).toEqual(before);
    expect(projectPartyAtScope(cohorts, undefined, catalog, { kind: "logical_day", dayId: "day-a" }))
      .toEqual({ status: "unconfirmed", reason: "baseline_required" });
  });
  it("does not flatten segment participation into a full day or silently rebind stale scopes", () => {
    const cohorts = resolvePartyCohorts([{ ...university, membership: "additional", scope: { kind: "segment", segmentNumber: 2 } }], catalog);
    expect(projectPartyAtScope(cohorts, 2, catalog, { kind: "segment", segmentId: "known-outbound" })).toMatchObject({ status: "known", people: 2 });
    expect(projectPartyAtScope(cohorts, 2, catalog, { kind: "segment", segmentId: "known-return" })).toMatchObject({ status: "known", people: 3 });
    expect(projectPartyAtScope(cohorts, 2, catalog, { kind: "logical_day", dayId: "day-a" })).toEqual({ status: "unconfirmed", reason: "scope_granularity" });
    for (const changed of [{ ...catalog, tripRevision: 5 }, { ...catalog, tripId: "another-trip" }]) {
      expect(() => assertPartyScopeCurrent(cohorts, changed)).toThrow("stale_scope");
      expect(projectPartyAtScope(cohorts, 2, changed, { kind: "segment", segmentId: "known-return" })).toEqual({ status: "unconfirmed", reason: "stale_scope" });
    }
    expect(() => assertPartyScopeCurrent(cohorts, { ...catalog, segments: [] })).toThrow("scope_not_found");
  });
  it("leaves inconsistent global count and detail subsets unconfirmed", () => {
    const cohorts = resolvePartyCohorts([{ ...university, count: 2 }]);
    expect(projectPartyAtScope(cohorts, 1, catalog, { kind: "logical_day", dayId: "day-a" }))
      .toEqual({ status: "unconfirmed", reason: "baseline_conflict" });
  });
});
