/** Anonymous, disjoint groups in this trip only. Attributes are not fare classes. */
export const schoolStages = ["preschool", "elementary", "middle_school", "high_school", "university"] as const;
export const ageDecades = ["teens", "twenties", "thirties", "forties", "fifties", "sixties", "seventies", "eighties", "nineties_plus"] as const;
export type SchoolStage = typeof schoolStages[number];
export type AgeDecade = typeof ageDecades[number];
export interface CohortAttributes {
  count: number;
  schoolStage?: SchoolStage;
  ageDecade?: AgeDecade;
  exactAge?: number;
}
export type ParticipationSelector = { kind: "whole_trip" }
  | { kind: "logical_days"; fromDay?: number; toDay?: number }
  | { kind: "segment"; segmentNumber: number };
export type ParticipationScope = { kind: "whole_trip" }
  | { kind: "logical_days"; tripId: string; tripRevision: number; dayIds: string[] }
  | { kind: "segment"; tripId: string; tripRevision: number; segmentId: string };
export interface PartyCohortInput extends CohortAttributes {
  /** baseline annotates a subset of the global count; additional never changes it. */
  membership: "baseline" | "additional";
  scope: ParticipationSelector;
}
export interface PartyCohort extends CohortAttributes {
  membership: "baseline" | "additional";
  scope: ParticipationScope;
}
/** Application-only catalog from an authorized, revision-bound Trip. Never model JSON. */
export interface PartyScopeCatalog {
  tripId: string;
  tripRevision: number;
  days: readonly { id: string; label: string }[];
  segments: readonly { id: string; label: string }[];
}
export class PartyCohortError extends Error {
  constructor(readonly code: "invalid_cohorts" | "scope_required" | "scope_not_found" | "stale_scope" | "baseline_conflict") {
    super(code); this.name = "PartyCohortError";
  }
}
export function ageInterval(decade: AgeDecade): readonly [number, number] {
  const index = ageDecades.indexOf(decade);
  if (index < 0) throw new PartyCohortError("invalid_cohorts");
  return [(index + 1) * 10, decade === "nineties_plus" ? 120 : (index + 2) * 10 - 1];
}

export function resolveParticipationScope(selector: ParticipationSelector, catalog?: PartyScopeCatalog): ParticipationScope {
  if (selector.kind === "whole_trip") return { kind: "whole_trip" };
  if (!catalog) throw new PartyCohortError("scope_required");
  const binding = { tripId: catalog.tripId, tripRevision: catalog.tripRevision };
  if (selector.kind === "segment") {
    const segment = catalog.segments[selector.segmentNumber - 1];
    if (!Number.isSafeInteger(selector.segmentNumber) || !segment || catalog.segments.filter(item => item.id === segment.id).length !== 1) throw new PartyCohortError("scope_not_found");
    return { kind: "segment", ...binding, segmentId: segment.id };
  }
  const first = selector.fromDay ?? 1, last = selector.toDay ?? catalog.days.length;
  if (selector.fromDay === undefined && selector.toDay === undefined ||
      !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > catalog.days.length)
    throw new PartyCohortError("scope_not_found");
  return { kind: "logical_days", ...binding, dayIds: catalog.days.slice(first - 1, last).map(day => day.id) };
}

export function resolvePartyCohorts(cohorts: readonly PartyCohortInput[], catalog?: PartyScopeCatalog): PartyCohort[] {
  return parsePartyCohorts(cohorts.map(cohort => ({ ...cohort, scope: resolveParticipationScope(cohort.scope, catalog) })));
}

/** Stored values have no real names, participant IDs, inferred roles or qualifications. */
export function parsePartyCohorts(value: unknown): PartyCohort[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new PartyCohortError("invalid_cohorts");
  const cohorts = value.map((item): PartyCohort => {
    if (!record(item) || !only(item, ["count", "schoolStage", "ageDecade", "exactAge", "membership", "scope"]) ||
        !integer(item.count, 1, 20) || !["baseline", "additional"].includes(String(item.membership)) ||
        item.schoolStage !== undefined && !schoolStages.includes(item.schoolStage as SchoolStage) ||
        item.ageDecade !== undefined && !ageDecades.includes(item.ageDecade as AgeDecade) ||
        item.exactAge !== undefined && !integer(item.exactAge, 0, 120)) throw new PartyCohortError("invalid_cohorts");
    if (item.exactAge !== undefined && item.ageDecade !== undefined) {
      const [min, max] = ageInterval(item.ageDecade as AgeDecade);
      if (Number(item.exactAge) < min || Number(item.exactAge) > max) throw new PartyCohortError("invalid_cohorts");
    }
    const scope = parseScope(item.scope);
    // A global addition is a count correction, not limited participation.
    if (item.membership === "additional" && scope.kind === "whole_trip") throw new PartyCohortError("invalid_cohorts");
    return { count: item.count, membership: item.membership as PartyCohort["membership"], scope,
      ...(item.schoolStage === undefined ? {} : { schoolStage: item.schoolStage as SchoolStage }),
      ...(item.ageDecade === undefined ? {} : { ageDecade: item.ageDecade as AgeDecade }),
      ...(item.exactAge === undefined ? {} : { exactAge: item.exactAge as number }) };
  });
  if (cohorts.reduce((sum, cohort) => sum + cohort.count, 0) > 20) throw new PartyCohortError("invalid_cohorts");
  // The aggregate is a set of anonymous groups; ordering is not identity.
  return cohorts.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
}

export function assertPartyScopeCurrent(cohorts: readonly PartyCohort[], catalog?: PartyScopeCatalog): void {
  for (const { scope } of cohorts) {
    if (scope.kind === "whole_trip") continue;
    if (!catalog) throw new PartyCohortError("scope_required");
    if (scope.tripId !== catalog.tripId || scope.tripRevision !== catalog.tripRevision) throw new PartyCohortError("stale_scope");
    if (scope.kind === "logical_days" ? scope.dayIds.some(id => !catalog.days.some(day => day.id === id))
      : catalog.segments.filter(segment => segment.id === scope.segmentId).length !== 1) throw new PartyCohortError("scope_not_found");
  }
}
export function assertCohortBaseline(cohorts: readonly Pick<PartyCohort, "membership" | "count">[], baselineCount: number): void {
  if (!integer(baselineCount, 1, 20) || cohorts.filter(c => c.membership === "baseline").reduce((sum, c) => sum + c.count, 0) > baselineCount ||
      baselineCount + cohorts.filter(c => c.membership === "additional").reduce((sum, c) => sum + c.count, 0) > 20)
    throw new PartyCohortError("baseline_conflict");
}
/** A day result must not silently include a segment-only participant (or vice versa). */
export function projectPartyAtScope(cohorts: readonly PartyCohort[], baselineCount: number | undefined,
  catalog: PartyScopeCatalog | undefined, at: { kind: "logical_day"; dayId: string } | { kind: "segment"; segmentId: string }):
  { status: "known"; people: number; cohorts: PartyCohort[]; unspecifiedBaseline: number } |
  { status: "unconfirmed"; reason: string } {
  try {
    const parsed = parsePartyCohorts(cohorts);
    assertPartyScopeCurrent(parsed, catalog);
    if (baselineCount === undefined) return { status: "unconfirmed", reason: "baseline_required" };
    assertCohortBaseline(parsed, baselineCount);
    if (!catalog || (at.kind === "logical_day" ? !catalog.days.some(day => day.id === at.dayId)
      : !catalog.segments.some(segment => segment.id === at.segmentId))) return { status: "unconfirmed", reason: "scope_not_found" };
    if (parsed.some(({ scope }) => scope.kind !== "whole_trip" &&
      (scope.kind === "logical_days" ? at.kind !== "logical_day" : at.kind !== "segment")))
      return { status: "unconfirmed", reason: "scope_granularity" };
    const present = parsed.filter(({ scope }) => scope.kind === "whole_trip" ||
      scope.kind === "logical_days" && at.kind === "logical_day" && scope.dayIds.includes(at.dayId) ||
      scope.kind === "segment" && at.kind === "segment" && scope.segmentId === at.segmentId);
    const unspecifiedBaseline = baselineCount - parsed.filter(c => c.membership === "baseline").reduce((sum, c) => sum + c.count, 0);
    const people = unspecifiedBaseline + present.reduce((sum, c) => sum + c.count, 0);
    if (people > 20) return { status: "unconfirmed", reason: "baseline_conflict" };
    return { status: "known", people, cohorts: present, unspecifiedBaseline };
  } catch (error) {
    if (error instanceof PartyCohortError) return { status: "unconfirmed", reason: error.code };
    throw error;
  }
}
function parseScope(value: unknown): ParticipationScope {
  if (!record(value)) throw new PartyCohortError("invalid_cohorts");
  if (value.kind === "whole_trip" && only(value, ["kind"])) return { kind: "whole_trip" };
  if (!reference(value.tripId) || !integer(value.tripRevision, 0, Number.MAX_SAFE_INTEGER)) throw new PartyCohortError("invalid_cohorts");
  if (value.kind === "logical_days" && only(value, ["kind", "tripId", "tripRevision", "dayIds"]) &&
      Array.isArray(value.dayIds) && value.dayIds.length > 0 && value.dayIds.length <= 90 && value.dayIds.every(reference) &&
      new Set(value.dayIds).size === value.dayIds.length)
    return { kind: "logical_days", tripId: value.tripId, tripRevision: value.tripRevision, dayIds: [...value.dayIds] };
  if (value.kind === "segment" && only(value, ["kind", "tripId", "tripRevision", "segmentId"]) && reference(value.segmentId))
    return { kind: "segment", tripId: value.tripId, tripRevision: value.tripRevision, segmentId: value.segmentId };
  throw new PartyCohortError("invalid_cohorts");
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }
function reference(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 200; }
function integer(value: unknown, min: number, max: number): value is number { return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max; }
