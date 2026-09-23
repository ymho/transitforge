import type { Trip, TripUpdateProposal } from "./trip";
import { applyTripProposal, validateTrip } from "./trip";

export type TripDeltaField = "schedule" | "place" | "selection" | "order" | "request" | "party" | "cost" | "timeline" | "structure";
export interface TripDeltaEntry { readonly itemId?: string; readonly fields: readonly TripDeltaField[]; readonly sourceItemId?: string; readonly constraintIds: readonly string[] }
export interface TripDelta { readonly tripId: string; readonly baseRevision: number; readonly entries: readonly TripDeltaEntry[]; readonly addedItemIds: readonly string[]; readonly removedItemIds: readonly string[] }
export interface ReplanDependencyIndex {
  readonly complete: boolean;
  readonly dayByItem: Readonly<Record<string, string | undefined>>;
  readonly segmentByItem: Readonly<Record<string, readonly string[]>>;
  readonly adjacentItems: Readonly<Record<string, readonly string[]>>;
  readonly sharedCostLines: Readonly<Record<string, readonly string[]>>;
  readonly evidenceByItem: Readonly<Record<string, readonly { observationRef: string; sourceScope: string; validUntil?: string; retention: string; principalRef: string }[]>>;
}
export interface RevalidationPlan {
  readonly mode: "incremental" | "full-conservative";
  readonly keepItemIds: readonly string[];
  readonly recomputeItemIds: readonly string[];
  readonly refetchItemIds: readonly string[];
  readonly reconfirmItemIds: readonly string[];
  readonly reasons: readonly { itemId: string; reason: string }[];
}

export function computeTripDelta(before: Trip, proposal: TripUpdateProposal): { after: Trip; delta: TripDelta } {
  validateTrip(before); const after = applyTripProposal(before, proposal);
  const beforeById = new Map(before.items.map((item) => [item.id, item])), afterById = new Map(after.items.map((item) => [item.id, item]));
  const entries: TripDeltaEntry[] = [];
  for (const item of before.items) {
    const next = afterById.get(item.id); if (!next) continue;
    const fields: TripDeltaField[] = [];
    if (stable(item.schedule) !== stable(next.schedule)) fields.push("schedule");
    if (stable(placeOf(item)) !== stable(placeOf(next))) fields.push("place");
    if (stable(selectionOf(item)) !== stable(selectionOf(next))) fields.push("selection");
    if (before.items.findIndex(({ id }) => id === item.id) !== after.items.findIndex(({ id }) => id === item.id)) fields.push("order");
    if (fields.length) entries.push({ itemId: item.id, sourceItemId: item.id, fields, constraintIds: constraintsFor(before, item.id) });
  }
  const requestFields: TripDeltaField[] = [];
  if (stable(before.request.party) !== stable(after.request.party)) requestFields.push("party");
  if (stable(before.request) !== stable(after.request)) requestFields.push("request");
  if (stable(before.costs) !== stable(after.costs)) requestFields.push("cost");
  if (stable(before.timeline) !== stable(after.timeline)) requestFields.push("timeline");
  if (stable(before.structureIntent) !== stable(after.structureIntent)) requestFields.push("structure");
  if (requestFields.length) entries.push({ fields: requestFields, constraintIds: before.request.constraints.map(({ id }) => id) });
  return { after, delta: { tripId: before.id, baseRevision: before.revision, entries,
    addedItemIds: after.items.filter(({ id }) => !beforeById.has(id)).map(({ id }) => id), removedItemIds: before.items.filter(({ id }) => !afterById.has(id)).map(({ id }) => id) } };
}

/** Incomplete indexes deliberately widen to a full evaluation. */
export function collectAffectedDependencies(trip: Trip, delta: TripDelta, index: ReplanDependencyIndex, evaluatedAt: string, principalRef: string): RevalidationPlan {
  validateTrip(trip); if (delta.tripId !== trip.id || delta.baseRevision !== trip.revision || !Number.isFinite(Date.parse(evaluatedAt))) throw new Error("Stale delta");
  const all = trip.items.map(({ id }) => id);
  if (!index.complete || delta.entries.some(({ itemId }) => itemId === undefined)) return { mode: "full-conservative", keepItemIds: [], recomputeItemIds: all,
    refetchItemIds: all, reconfirmItemIds: all, reasons: all.map((itemId) => ({ itemId, reason: "dependency-index-incomplete" })) };
  const recompute = new Set([...delta.addedItemIds, ...delta.removedItemIds]), refetch = new Set<string>(), reconfirm = new Set<string>();
  const reasons: { itemId: string; reason: string }[] = [];
  for (const entry of delta.entries) {
    const id = entry.itemId!; recompute.add(id); reasons.push({ itemId: id, reason: `changed:${entry.fields.join(",")}` });
    for (const adjacent of index.adjacentItems[id] ?? []) { recompute.add(adjacent); reasons.push({ itemId: adjacent, reason: `connection:${id}` }); }
    const day = index.dayByItem[id], segments = new Set(index.segmentByItem[id] ?? []);
    for (const candidate of all) if (candidate !== id && (day && index.dayByItem[candidate] === day || (index.segmentByItem[candidate] ?? []).some((segment) => segments.has(segment)))) recompute.add(candidate);
    for (const shared of index.sharedCostLines[id] ?? []) for (const candidate of all) if ((index.sharedCostLines[candidate] ?? []).includes(shared)) recompute.add(candidate);
    for (const fact of index.evidenceByItem[id] ?? []) if (fact.principalRef !== principalRef || fact.sourceScope !== id || fact.retention === "prohibited" || fact.validUntil === undefined || Date.parse(fact.validUntil) < Date.parse(evaluatedAt)) refetch.add(id);
    if (entry.fields.some((field) => field === "schedule" || field === "selection" || field === "place")) reconfirm.add(id);
  }
  for (const id of recompute) if (!(index.evidenceByItem[id]?.length)) refetch.add(id);
  return { mode: "incremental", keepItemIds: all.filter((id) => !recompute.has(id)), recomputeItemIds: [...recompute].sort(), refetchItemIds: [...refetch].sort(), reconfirmItemIds: [...reconfirm].sort(), reasons };
}

/** The full result is the oracle. Reused slices are accepted only with equal fingerprints. */
export function evaluateIncrementally<T>(ids: readonly string[], plan: RevalidationPlan,
  previous: Readonly<Record<string, { fingerprint: string; value: T }>>, fingerprint: (id: string) => string, evaluate: (id: string) => T): Readonly<Record<string, T>> {
  const output: Record<string, T> = {}, recompute = new Set(plan.recomputeItemIds);
  for (const id of ids) {
    const cached = previous[id];
    output[id] = !recompute.has(id) && cached?.fingerprint === fingerprint(id) ? cached.value : evaluate(id);
  }
  return output;
}

function constraintsFor(trip: Trip, itemId: string): string[] { return trip.request.constraints.filter((constraint) => constraint.scope.type !== "item" || constraint.scope.itemId === itemId).map(({ id }) => id); }
function placeOf(item: Trip["items"][number]): unknown { return item.type === "activity" ? item.place : item.type === "stay" ? item.selection.status === "selected" ? item.selection.accommodation.place : item.selection.place : item.detail.status === "selected" && item.detail.mode !== "rail" ? [item.detail.origin, item.detail.destination] : undefined; }
function selectionOf(item: Trip["items"][number]): unknown { return item.type === "stay" ? item.selection : item.type === "transport" ? item.detail : undefined; }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${key}:${stable(item)}`).join(",")}}`; return JSON.stringify(value); }
