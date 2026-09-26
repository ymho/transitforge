import { expect, it, vi } from "vitest";
import { createServerAgentApplication } from "./server-agent.js";
import { AgentModelError } from "@raiquora/agent/model-provider";
import { ServerAgentRuntimeExecutionError } from "../../ports/server-agent-runtime.js";

it("emits privacy-safe diagnostics and does not fail the turn when the sink fails", async () => {
  const record = vi.fn(async (event) => { if (event.phase === "decision") throw new Error("sink unavailable"); }), log = vi.fn();
  const app = createServerAgentApplication({ newExecutionId: () => "execution", diagnostics: { record }, log,
    loadContext: async () => ({ currentTrip: { id: "trip", sourceRevision: 4, schedule: [], scheduleTruncated: true },
      travelProfile: { consentedPreferenceNotes: { food: "private-food" } } }),
    registerTools: () => undefined,
    createModel: () => ({ generate: async () => ({ message: { role: "assistant", content: [{ type: "text", text: "回答" }] }, stopReason: "completed",
      metadata: { provider: "fixture" }, decisionSummaryStatus: "valid", decisionSummary: { interpretedGoal: "相談", hardConstraints: [], softPreferences: [],
        selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["goal_interpreted"] } }) }),
  });
  const result = await app.runAgentTurn({ principal: { subject: "owner", identity: { subject: "owner", issuer: "issuer" }, scopes: ["trip:read"] }, userRequest: "private-request" });
  expect(result.status).toBe("completed");
  expect(JSON.stringify(record.mock.calls)).not.toContain("private-food");
  expect(JSON.stringify(record.mock.calls)).not.toContain("private-request");
  expect(record.mock.calls[0]?.[0]).toMatchObject({ phase: "context", counts: { acceptedCharacters: 15, omitted: 1 }, correlation: { tripRevision: 4 } });
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ phase: "runtime", reason: "completed", incomplete: false }));
  expect(log).toHaveBeenCalledWith("agent_diagnostic_dropped", { executionId: "execution", phase: "decision" });
});

it.each([
  ["refusal", "provider_refusal"],
  ["provider_error", "provider_error"],
  ["invalid_schema", "model_invalid_schema"],
] as const)("classifies %s without retaining provider text", async (code, expectedReason) => {
  const record = vi.fn();
  const app = createServerAgentApplication({
    newExecutionId: () => "execution",
    diagnostics: { record },
    registerTools: () => undefined,
    createModel: () => ({ generate: async () => { throw new AgentModelError(code, "private provider detail", false); } }),
  });
  const result = await app.runAgentTurn({
    principal: { subject: "owner", identity: { subject: "owner", issuer: "issuer" }, scopes: ["trip:read"] },
    userRequest: "private-request",
  });
  expect(result.status).toBe("failed");
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ phase: "runtime", reason: expectedReason, incomplete: true }));
  expect(JSON.stringify(record.mock.calls)).not.toContain("private provider detail");
});


it("records only bounded V2 runtime throw classification before rethrowing", async () => {
  const record = vi.fn();
  const app = createServerAgentApplication({
    newExecutionId: () => "execution",
    diagnostics: { record },
    registerTools: () => undefined,
    createModel: () => ({ generate: async () => { throw new Error("V1 must not run"); } }),
    runRuntime: async () => { throw new ServerAgentRuntimeExecutionError("agent_invoke", "provider"); },
  });
  await expect(app.runAgentTurn({
    principal: { subject: "owner", identity: { subject: "owner", issuer: "issuer" }, scopes: ["trip:read"] },
    userRequest: "private-request",
  })).rejects.toBeInstanceOf(ServerAgentRuntimeExecutionError);
  expect(record).toHaveBeenCalledWith(expect.objectContaining({
    phase: "runtime", reason: "failed", mode: "v2:agent_invoke:provider", incomplete: true,
  }));
  expect(JSON.stringify(record.mock.calls)).not.toContain("private-request");
});
