import type { ItinerarySchedule } from "./itinerary-schedule";
import { validateTrip, type Trip } from "./trip";

export interface TemporalConstraintEdge {
  readonly constraintId: string;
  readonly from: string;
  readonly to: string;
  readonly minimumMinutes?: number;
  readonly maximumMinutes?: number;
  readonly itemIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly kind: "duration" | "order" | "travel" | "opening-window" | "reservation-anchor" | "participant" | "resource" | "calendar-bound";
}
export interface TemporalConstraintNetwork {
  readonly version: 1;
  readonly planRef: string;
  readonly variables: readonly string[];
  readonly edges: readonly TemporalConstraintEdge[];
  readonly missingFactRefs: readonly string[];
  readonly evaluatedScope: readonly string[];
}
export interface TemporalCheckBudget { readonly maximumRelaxations: number }
export interface TemporalCheckResult {
  readonly status: "feasible" | "infeasible" | "unknown";
  readonly evaluatedScope: readonly string[];
  readonly missingFactRefs: readonly string[];
  readonly conflictEdges: readonly TemporalConstraintEdge[];
  readonly witness?: Readonly<Record<string, number>>;
  readonly exhaustedBudget: boolean;
  readonly repairCandidates: readonly { kind: "move-to-window" | "reduce-duration" | "research-connection"; itemIds: readonly string[]; automatic: false; requiresConstraintRevalidation: true; descriptionCode: string }[];
}
export type TemporalBuildFact =
  | { type: "travel-lower-bound"; constraintId: string; beforeItemId: string; afterItemId: string; minutes: number; evidenceRefs: readonly string[] }
  | { type: "opening-window"; constraintId: string; itemId: string; opensAt: string; closesAt: string; evidenceRefs: readonly string[] }
  | { type: "reservation-anchor"; constraintId: string; itemId: string; startsAt?: string; endsAt?: string; evidenceRefs: readonly string[] }
  | { type: "explicit-order" | "participant-order" | "resource-order"; constraintId: string; beforeItemId: string; afterItemId: string; evidenceRefs: readonly string[] };

/** Builds one global network. Stay day spans are deliberately omitted as exclusive occupancy. */
export function buildTemporalConstraintNetwork(trip: Trip, facts: readonly TemporalBuildFact[] = [], scopeItemIds?: readonly string[]): TemporalConstraintNetwork {
  validateTrip(trip);
  const included = new Set(scopeItemIds ?? trip.items.map(({ id }) => id));
  if ([...included].some((id) => !trip.items.some((item) => item.id === id))) throw new Error("Unknown temporal scope");
  const variables = ["origin"], edges: TemporalConstraintEdge[] = [], missing = new Set<string>();
  const add = (edge: TemporalConstraintEdge) => { validateEdge(edge); edges.push(edge); };
  for (const item of trip.items.filter(({ id }) => included.has(id))) {
    const start = `${item.id}:start`, end = `${item.id}:end`; variables.push(start, end);
    const bounds = scheduleBounds(item.schedule);
    if (!bounds) { missing.add(`schedule:${item.id}`); continue; }
    if (bounds.startMinimum !== undefined || bounds.startMaximum !== undefined) add({ constraintId: `schedule:${item.id}:start`, from: "origin", to: start,
      ...(bounds.startMinimum === undefined ? {} : { minimumMinutes: bounds.startMinimum }), ...(bounds.startMaximum === undefined ? {} : { maximumMinutes: bounds.startMaximum }),
      itemIds: [item.id], evidenceRefs: [], kind: "calendar-bound" });
    if (bounds.endMinimum !== undefined || bounds.endMaximum !== undefined) add({ constraintId: `schedule:${item.id}:end`, from: "origin", to: end,
      ...(bounds.endMinimum === undefined ? {} : { minimumMinutes: bounds.endMinimum }), ...(bounds.endMaximum === undefined ? {} : { maximumMinutes: bounds.endMaximum }),
      itemIds: [item.id], evidenceRefs: [], kind: "calendar-bound" });
    if (bounds.durationMinimum !== undefined || bounds.durationMaximum !== undefined) add({ constraintId: `duration:${item.id}`, from: start, to: end,
      ...(bounds.durationMinimum === undefined ? {} : { minimumMinutes: bounds.durationMinimum }), ...(bounds.durationMaximum === undefined ? {} : { maximumMinutes: bounds.durationMaximum }),
      itemIds: [item.id], evidenceRefs: [], kind: "duration" });
    else missing.add(`duration:${item.id}`);
  }
  for (const fact of facts) {
    if (fact.type === "travel-lower-bound") add({ constraintId: fact.constraintId, from: `${fact.beforeItemId}:end`, to: `${fact.afterItemId}:start`,
      minimumMinutes: fact.minutes, itemIds: [fact.beforeItemId, fact.afterItemId], evidenceRefs: fact.evidenceRefs, kind: "travel" });
    else if (fact.type === "opening-window") {
      const opens = epochMinutes(fact.opensAt), closes = epochMinutes(fact.closesAt);
      add({ constraintId: `${fact.constraintId}:open`, from: "origin", to: `${fact.itemId}:start`, minimumMinutes: opens,
        itemIds: [fact.itemId], evidenceRefs: fact.evidenceRefs, kind: "opening-window" });
      add({ constraintId: `${fact.constraintId}:close`, from: "origin", to: `${fact.itemId}:end`, maximumMinutes: closes,
        itemIds: [fact.itemId], evidenceRefs: fact.evidenceRefs, kind: "opening-window" });
    } else if (fact.type === "reservation-anchor") {
      if (fact.startsAt) add({ constraintId: `${fact.constraintId}:start`, from: "origin", to: `${fact.itemId}:start`, minimumMinutes: epochMinutes(fact.startsAt), maximumMinutes: epochMinutes(fact.startsAt), itemIds: [fact.itemId], evidenceRefs: fact.evidenceRefs, kind: "reservation-anchor" });
      if (fact.endsAt) add({ constraintId: `${fact.constraintId}:end`, from: "origin", to: `${fact.itemId}:end`, minimumMinutes: epochMinutes(fact.endsAt), maximumMinutes: epochMinutes(fact.endsAt), itemIds: [fact.itemId], evidenceRefs: fact.evidenceRefs, kind: "reservation-anchor" });
    } else add({ constraintId: fact.constraintId, from: `${fact.beforeItemId}:end`, to: `${fact.afterItemId}:start`, minimumMinutes: 0,
      itemIds: [fact.beforeItemId, fact.afterItemId], evidenceRefs: fact.evidenceRefs,
      kind: fact.type === "participant-order" ? "participant" : fact.type === "resource-order" ? "resource" : "order" });
  }
  const set = new Set(variables);
  if (edges.some((edge) => !set.has(edge.from) || !set.has(edge.to))) throw new Error("Temporal fact outside scope");
  return { version: 1, planRef: `${trip.id}@${trip.revision}`, variables, edges, missingFactRefs: [...missing].sort(), evaluatedScope: [...included].sort() };
}

/** Bellman-Ford over difference constraints. No general solver dependency is required. */
export function checkTemporalConsistency(network: TemporalConstraintNetwork, budget: TemporalCheckBudget = { maximumRelaxations: 100_000 }): TemporalCheckResult {
  if (!Number.isSafeInteger(budget.maximumRelaxations) || budget.maximumRelaxations <= 0) throw new Error("Invalid temporal budget");
  const constraints = network.edges.flatMap((edge) => [
    ...(edge.maximumMinutes === undefined ? [] : [{ from: edge.from, to: edge.to, weight: edge.maximumMinutes, edge }]),
    ...(edge.minimumMinutes === undefined ? [] : [{ from: edge.to, to: edge.from, weight: -edge.minimumMinutes, edge }]),
  ]);
  const distance = new Map(network.variables.map((variable) => [variable, 0]));
  const predecessor = new Map<string, TemporalConstraintEdge>();
  let relaxations = 0, changed = "";
  for (let pass = 0; pass < network.variables.length; pass++) {
    changed = "";
    for (const constraint of constraints) {
      if (++relaxations > budget.maximumRelaxations) return result("unknown", [], undefined, true);
      const candidate = distance.get(constraint.from)! + constraint.weight;
      if (candidate < distance.get(constraint.to)!) { distance.set(constraint.to, candidate); predecessor.set(constraint.to, constraint.edge); changed = constraint.to; }
    }
    if (!changed) break;
    if (pass === network.variables.length - 1) {
      const conflict = new Map<string, TemporalConstraintEdge>();
      let cursor = changed;
      for (let i = 0; i < network.variables.length; i++) { const edge = predecessor.get(cursor); if (!edge) break; conflict.set(edge.constraintId, edge); cursor = edge.from; }
      const traced = [...conflict.values()];
      return result("infeasible", traced.length > 1 ? traced : network.edges, undefined, false);
    }
  }
  const origin = distance.get("origin") ?? 0;
  const witness = Object.fromEntries([...distance].map(([key, value]) => [key, value - origin]));
  return result(network.missingFactRefs.length ? "unknown" : "feasible", [], witness, false);

  function result(status: TemporalCheckResult["status"], conflictEdges: readonly TemporalConstraintEdge[], witness: Record<string, number> | undefined, exhaustedBudget: boolean): TemporalCheckResult {
    const itemIds = [...new Set(conflictEdges.flatMap((edge) => edge.itemIds))];
    return { status, evaluatedScope: network.evaluatedScope, missingFactRefs: network.missingFactRefs, conflictEdges,
      ...(witness ? { witness } : {}), exhaustedBudget,
      repairCandidates: status === "infeasible" ? [
        { kind: "move-to-window", itemIds, automatic: false, requiresConstraintRevalidation: true, descriptionCode: "move_conflicting_item" },
        { kind: "reduce-duration", itemIds, automatic: false, requiresConstraintRevalidation: true, descriptionCode: "reduce_flexible_duration" },
      ] : exhaustedBudget || network.missingFactRefs.length ? [{ kind: "research-connection", itemIds, automatic: false, requiresConstraintRevalidation: true, descriptionCode: "verify_missing_temporal_facts" }] : [] };
  }
}

function scheduleBounds(schedule: ItinerarySchedule): { startMinimum?: number; startMaximum?: number; endMinimum?: number; endMaximum?: number; durationMinimum?: number; durationMaximum?: number } | undefined {
  if (schedule.type === "fixed") { const start = epochMinutes(schedule.startAt.at), end = schedule.endAt ? epochMinutes(schedule.endAt.at) : undefined;
    return { startMinimum: start, startMaximum: start, ...(end === undefined ? {} : { endMinimum: end, endMaximum: end, durationMinimum: end - start, durationMaximum: end - start }) }; }
  if (schedule.type === "window") { const start = epochMinutes(schedule.earliestStart.at), end = epochMinutes(schedule.latestEnd.at);
    return { startMinimum: start, startMaximum: end - (schedule.durationMinutes ?? 0), endMinimum: start + (schedule.durationMinutes ?? 0), endMaximum: end,
      ...(schedule.durationMinutes === undefined ? {} : { durationMinimum: schedule.durationMinutes, durationMaximum: schedule.durationMinutes }) }; }
  return undefined;
}
function epochMinutes(value: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error("Invalid temporal instant"); return Math.trunc(parsed / 60_000); }
function validateEdge(edge: TemporalConstraintEdge): void { if (!edge.constraintId || edge.minimumMinutes === undefined && edge.maximumMinutes === undefined ||
  edge.minimumMinutes !== undefined && !Number.isFinite(edge.minimumMinutes) || edge.maximumMinutes !== undefined && !Number.isFinite(edge.maximumMinutes) ||
  edge.minimumMinutes !== undefined && edge.maximumMinutes !== undefined && edge.minimumMinutes > edge.maximumMinutes) throw new Error("Invalid temporal edge"); }
