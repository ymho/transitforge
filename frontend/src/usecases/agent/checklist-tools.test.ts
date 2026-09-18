import { it, expect } from "vitest";
import { registerChecklistTool, checklistDescriptor } from "./checklist-tools";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import type { ChecklistProposal } from "@raiquora/trip/trip-checklist";
import { checklistItem } from "../../../../modules/trip/domain/trip-checklist.fixture";
import { feasibilityTrip, feasibilityFacts, feasibilityNow } from "../../../../modules/trip/domain/trip-feasibility.fixture";
import { evaluateTripFeasibility } from "@raiquora/trip/trip-feasibility";
import { projectTripReadiness } from "@raiquora/trip/trip-readiness";
import { tripReadinessContext, boundTripReadinessContext } from "@raiquora/agent/trip-readiness-context";
import { observeViewerTurn } from "./viewer-turn-progress";

it("only produces typed add previews; rejects status/derived completion/private fields; no default unavailable tool", async () => {
  const trip = feasibilityTrip(), registry = new AgentToolRegistry(), state: { proposal?: ChecklistProposal } = {};
  registerChecklistTool(registry, trip, [checklistItem({ status: "not-needed" })], state, []);
  const run = (suggestions: unknown[]) => registry.execute(checklistDescriptor.name, { suggestions }, {} as never);
  for (const extra of [{ status: "done" }, { ownerId: "A" }, { bookingReference: "secret" }, { id: "fake" }, { code: "movement_unknown" }]) {
    expect((await run([{ category: "packing", title: "傘", ...extra }])).ok).toBe(false);
  }
  expect((await run([{ category: "connectivity", title: " ＳＩＭ " }])).ok).toBe(true); expect(state.proposal).toBeUndefined();
  expect((await run([{ category: "packing", title: "傘", relatedItineraryItemId: "unknown" }])).ok).toBe(false);
  expect((await run([{ category: "packing", title: "傘" }])).ok).toBe(true);
  expect(state.proposal).toEqual({ tripId: trip.id, suggestions: [{ category: "packing", title: "傘" }] });
  const observed = observeViewerTurn({ text: "未保存の準備案", checklistProposal: state.proposal! }, []);
  expect(observed.progress).toEqual([{ kind: "checklist_proposal", refs: [trip.id] }]);
  const unavailable = new AgentToolRegistry(); registerChecklistTool(unavailable, trip, undefined, {});
  expect(unavailable.descriptors()).toEqual([]);
});
it("bounds checklist context, keeps counts/truncation and strips private/raw keys during recompression", () => {
  const trip = feasibilityTrip(), facts = feasibilityFacts(trip);
  const items = Array.from({ length: 30 }, (_, i) => checklistItem({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`, title: `準備${i}` }));
  const context = tripReadinessContext(projectTripReadiness(trip, evaluateTripFeasibility(trip, facts, feasibilityNow), [], items), items);
  expect(context.preparation).toHaveLength(24); expect(context.counts.preparation).toBe(30); expect(context.truncated).toBe(true);
  const malicious = { ...context, bookingReference: "PRIVATE", raw: { secret: "SECRET" }, preparation: context.preparation.map((i) => ({ ...i, passenger: "PRIVATE" })) };
  const bounded = boundTripReadinessContext(malicious);
  expect(JSON.stringify(bounded)).not.toMatch(/PRIVATE|SECRET|passenger|bookingReference/);
  expect(bounded.counts.preparation).toBe(30); expect(bounded.truncated).toBe(true);
});
