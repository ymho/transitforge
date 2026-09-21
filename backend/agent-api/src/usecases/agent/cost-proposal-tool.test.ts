import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { costForecast, costTripId } from "../../../../../modules/trip/domain/trip-costs.fixture";
import { registerCostProposalTool } from "./cost-proposal-tool.js";
const context = { executionId: "turn", toolCallId: "cost", now: new Date("2026-09-21T00:00:00Z") };
it("binds a forecast to the authorized Trip, preserves unknowns and rejects model authority or missing assumptions", async () => {
  const trip = createTrip(costTripId, "旅行", "2026-09-20T00:00:00Z"), tools = new AgentToolRegistry(), publish = vi.fn();
  registerCostProposalTool(tools, trip, publish, () => context.now);
  const items = costForecast().items;
  expect((await tools.execute("propose_trip_costs", { items }, context)).ok).toBe(true);
  expect(publish.mock.calls[0][0]).toMatchObject({ tripId: trip.id, baseRevision: 0, patches: [{ type: "cost_forecast", forecast: { generatedAt: context.now.toISOString(), items } }] });
  for (const input of [{ items, tripId: "foreign" }, { items, overrides: { food: 0 } }, { items: items.map(i => ({ ...i, assumptions: [] })) }, { items: items.slice(1) }]) {
    expect((await tools.execute("propose_trip_costs", input, context)).ok).toBe(false);
  }
  expect(publish).toHaveBeenCalledOnce(); expect(trip.costs).toBeUndefined();
  expect((await tools.execute("propose_trip_costs", { items: items.map(({ amount: _amount, ...i }) => i) }, context)).ok).toBe(true);
});
