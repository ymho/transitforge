import { describe, expect, it } from "vitest";
import { buildTemporalConstraintNetwork, checkTemporalConsistency } from "./temporal-constraint-network";
import type { Trip } from "./trip";

const window = { type: "window" as const, earliestStart: { at: "2026-10-01T09:00:00+09:00", timeZone: "Asia/Tokyo" }, latestEnd: { at: "2026-10-01T11:00:00+09:00", timeZone: "Asia/Tokyo" }, durationMinutes: 60 };
const trip = (count: number): Trip => ({ id: "11111111-1111-4111-8111-111111111111", schemaVersion: 2, revision: 3, title: "global",
  request: { constraints: [], assumptions: [] }, planningState: "itinerary_draft", lifecycleState: "pre_trip", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
  items: Array.from({ length: count }, (_, index) => ({ id: `activity-${index}`, title: `A${index}`, type: "activity" as const, category: "sightseeing" as const, schedule: window })) });
const ordered = (count: number) => Array.from({ length: count - 1 }, (_, index) => ({ type: "explicit-order" as const, constraintId: `order-${index}`,
  beforeItemId: `activity-${index}`, afterItemId: `activity-${index + 1}`, evidenceRefs: [] }));

describe("global temporal constraint network", () => {
  it("detects a three-item chain that pairwise windows alone cannot place", () => {
    const result = checkTemporalConsistency(buildTemporalConstraintNetwork(trip(3), ordered(3)));
    expect(result.status).toBe("infeasible"); expect(result.conflictEdges.length).toBeGreaterThan(1);
  });
  it("returns a witness on the exact boundary and independently validates every edge", () => {
    const network = buildTemporalConstraintNetwork(trip(2), ordered(2)); const result = checkTemporalConsistency(network);
    expect(result.status).toBe("feasible");
    for (const edge of network.edges) { const delta = result.witness![edge.to]! - result.witness![edge.from]!;
      if (edge.minimumMinutes !== undefined) expect(delta).toBeGreaterThanOrEqual(edge.minimumMinutes);
      if (edge.maximumMinutes !== undefined) expect(delta).toBeLessThanOrEqual(edge.maximumMinutes); }
  });
  it("returns unknown rather than feasible when schedule facts or budget are missing", () => {
    const source = trip(1); const unknown: Trip = { ...source, items: [{ ...source.items[0]!, schedule: { type: "unscheduled" } }] };
    expect(checkTemporalConsistency(buildTemporalConstraintNetwork(unknown)).status).toBe("unknown");
    expect(checkTemporalConsistency(buildTemporalConstraintNetwork(trip(2), ordered(2)), { maximumRelaxations: 1 })).toMatchObject({ status: "unknown", exhaustedBudget: true });
  });
  it("adds travel lower bounds to the same network", () => {
    const result = checkTemporalConsistency(buildTemporalConstraintNetwork(trip(2), [{ type: "travel-lower-bound", constraintId: "travel-1", beforeItemId: "activity-0", afterItemId: "activity-1", minutes: 1, evidenceRefs: ["route-1"] }]));
    expect(result.status).toBe("infeasible");
  });
});
