import { expect, it, vi } from "vitest";
import { createServerAgentApplication } from "./server-agent.js";
import { ServerAgentRuntimeExecutionError } from "../../ports/server-agent-runtime.js";

it("emits privacy-safe diagnostics and does not fail the turn when the sink fails", async () => {
  const record = vi.fn(async (event) => { if (event.phase === "decision") throw new Error("sink unavailable"); }), log = vi.fn();
  const app = createServerAgentApplication({ newExecutionId: () => "execution", diagnostics: { record }, log,
    loadContext: async () => ({ currentTrip: { id: "trip", sourceRevision: 4, schedule: [], scheduleTruncated: true },
      travelProfile: { consentedPreferenceNotes: { food: "private-food" } } }),
    registerTools: () => undefined,
    runRuntime: async ({ executionId }) => ({ status: "completed", response: "回答", evidence: [], claims: [],
      trace: { executionId, droppedEventCount: 0, events: [{ type: "decision_recorded", occurredAt: "2026-10-04T00:00:00Z" }] } } as never),
  });
  const result = await app.runAgentTurn({ principal: { subject: "owner", identity: { subject: "owner", issuer: "issuer" }, scopes: ["trip:read"] }, userRequest: "private-request" });
  expect(result.status).toBe("completed");
  expect(JSON.stringify(record.mock.calls)).not.toContain("private-food");
  expect(JSON.stringify(record.mock.calls)).not.toContain("private-request");
  expect(record.mock.calls[0]?.[0]).toMatchObject({ phase: "context", counts: { acceptedCharacters: 15, omitted: 1 }, correlation: { tripRevision: 4 } });
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ phase: "runtime", reason: "completed", incomplete: false }));
  expect(log).toHaveBeenCalledWith("agent_diagnostic_dropped", { executionId: "execution", phase: "decision" });
});

it("records only bounded V2 runtime throw classification before rethrowing", async () => {
  const record = vi.fn();
  const app = createServerAgentApplication({
    newExecutionId: () => "execution",
    diagnostics: { record },
    registerTools: () => undefined,

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


it("publishes only allowlisted V2 publication failure codes in runtime diagnostics", async () => {
  const record = vi.fn();
  const trace = { executionId: "execution", omitContent: true, events: [{ type: "task_started", occurredAt: "2026-09-26T00:00:00Z" }, { type: "task_completed", occurredAt: "2026-09-26T00:00:01Z", outcome: "completed", reason: "completed", latencyMs: 1 }] };
  const app = createServerAgentApplication({
    newExecutionId: () => "execution", diagnostics: { record }, registerTools: () => undefined,

    runRuntime: async () => ({ status: "failed", response: "", evidence: [], claims: [], trace, publicationError: "missing_reply_proposal" } as never),
  });
  const result = await app.runAgentTurn({
    principal: { subject: "owner", identity: { subject: "owner", issuer: "issuer" }, scopes: ["trip:read"] },
    userRequest: "private-request",
  });
  expect(result.status).toBe("failed");
  expect(record).toHaveBeenCalledWith(expect.objectContaining({
    phase: "runtime", mode: "v2:publication:missing_reply_proposal", incomplete: true,
  }));
  expect(JSON.stringify(record.mock.calls)).not.toContain("private-request");
});


it.each(["invalid_input", "private-code"])("bounds Tool error classification: %s", async errorCode => {
  const record = vi.fn();
  const app = createServerAgentApplication({ newExecutionId: () => "execution", diagnostics: { record }, registerTools: () => undefined,

    runRuntime: async () => ({ status: "limit_reached", response: "", evidence: [], claims: [], trace: { executionId: "execution", events: [
      { type: "tool_completed", toolCallId: "tool-1", toolName: "draft_itinerary", occurredAt: "2026-10-03T00:00:00Z",
        outcome: "error", latencyMs: 1, errorCode, result: { private: "private-result" } },
    ] } } as never),
  });
  await app.runAgentTurn({ principal: { subject: "owner", identity: { subject: "owner", issuer: "issuer" }, scopes: ["trip:read"] }, userRequest: "private-request" });
  const event = record.mock.calls.map(([value]) => value).find(value => value.phase === "tool");
  expect(event.toolErrorCode).toBe(errorCode === "invalid_input" ? "invalid_input" : undefined);
  expect(JSON.stringify(event)).not.toMatch(/private-code|private-result|private-request/);
});

it("distinguishes public projection failure after a completed execution without logging its payload", async () => {
  const record = vi.fn();
  const app = createServerAgentApplication({ newExecutionId: () => "execution", diagnostics: { record }, registerTools: () => undefined,

    runRuntime: async () => ({ status: "completed", response: "private response", evidence: [], claims: [], trace: { executionId: "execution", events: [], droppedEventCount: 0 } }),
    projectResult: () => { throw Error("private provider data"); },
  });
  await expect(app.runAgentTurn({ principal: { subject: "owner", identity: { subject: "owner", issuer: "issuer" }, scopes: ["trip:read"] }, userRequest: "private request" })).rejects.toThrow();
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ phase: "presentation", reason: "schema_invalid", mode: "application-projection" }));
  expect(JSON.stringify(record.mock.calls)).not.toMatch(/private response|private provider|private request/);
});
