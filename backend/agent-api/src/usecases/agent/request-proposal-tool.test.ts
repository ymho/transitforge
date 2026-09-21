import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { registerRequestProposalTool } from "./request-proposal-tool.js";
const id = "11111111-1111-4111-8111-111111111111";
const context = { executionId: "turn", toolCallId: "call", now: new Date() };
it("rejects model authority, confirmed assumptions, existing condition rewrites and extra fields", async () => {
  const trip = createTrip(id, "旅行", "2026-09-01T00:00:00Z", [], { goal: "散策", constraints: [], assumptions: [] });
  const tools = new AgentToolRegistry(), publish = vi.fn(); registerRequestProposalTool(tools, trip, publish);
  for (const input of [
    { request: { ...trip.request, goal: "別の目的" } },
    { request: trip.request, tripId: "foreign", actor: "user" },
    { request: { ...trip.request, assumptions: [{ id: "a", text: "確認済み", source: "model", status: "confirmed", affects: [] }] } },
    { request: { ...trip.request, constraints: [{ id: "c", source: "user", strength: "hard", scope: { type: "trip" }, requirement: { type: "pace", value: 0.5 } }] } },
  ]) expect((await tools.execute("propose_request_assumptions", input, context)).ok).toBe(false);
  expect(publish).not.toHaveBeenCalled();
});
it("combines changes and later assumptions into one immutable revision-bound proposal", async () => {
  const trip = createTrip(id, "旅行", "2026-09-01T00:00:00Z", [], { goal: "散策", constraints: [], assumptions: [] });
  const tools = new AgentToolRegistry(), publish = vi.fn(); registerRequestProposalTool(tools, trip, publish);
  const result = await tools.execute("propose_request_changes", { changes: [{ type: "set_goal", goal: "美術館", reason: "目的の変更案" }] }, context);
  expect(result.ok).toBe(true);
  const changed = publish.mock.calls[0][0]; expect(changed.patches[0].request.goal).toBe("美術館");
  const request = { ...changed.patches[0].request, assumptions: [{ id: "new", text: "ゆっくり巡る仮定", source: "model", status: "unconfirmed", affects: [] }] };
  expect((await tools.execute("propose_request_assumptions", { request }, context)).ok).toBe(true);
  expect(publish.mock.calls[1][0]).toMatchObject({ tripId: id, baseRevision: 0, patches: [{ type: "request", request }] });
  expect(trip.request.goal).toBe("散策");
  expect((await tools.execute("propose_request_changes", { changes: [{ type: "remove_constraint", constraintId: "foreign", reason: "不正" }] }, context)).ok).toBe(false);
  expect(publish).toHaveBeenCalledTimes(2);
});
it("does not advance the preview when the public proposal cannot be published", async () => {
  const trip = createTrip(id, "相談", "2026-09-01T00:00:00Z"), tools = new AgentToolRegistry();
  const publish = vi.fn().mockImplementationOnce(() => { throw new Error("public budget exceeded"); });
  registerRequestProposalTool(tools, trip, publish);
  const input = { changes: [{ type: "set_goal", goal: "美術館", reason: "目的の変更案" }] };
  expect((await tools.execute("propose_request_changes", input, context)).ok).toBe(false);
  expect((await tools.execute("propose_request_changes", input, context)).ok).toBe(true);
  expect(publish).toHaveBeenCalledTimes(2);
});
