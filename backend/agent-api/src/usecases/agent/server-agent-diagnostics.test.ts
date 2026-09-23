import { expect, it, vi } from "vitest";
import { createServerAgentApplication } from "./server-agent.js";

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
  expect(log).toHaveBeenCalledWith("agent_diagnostic_dropped", { executionId: "execution", phase: "decision" });
});
