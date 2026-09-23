import { expect, it, vi } from "vitest";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { registerServerTools } from "./server-tools.js";

it.each([[400, false], [404, false], [429, true], [500, true], [503, true]])("maps operation %s retryability without exposing response details", async (statusCode, retryable) => {
  const tools = new AgentToolRegistry();
  registerServerTools(tools, new ToolEvidenceRegistry(), [{
    descriptor: { name: "provider", description: "provider boundary", inputSchema: { type: "object", properties: {} } },
    operation: async () => ({ statusCode: statusCode as number, body: { privateProviderDetail: "hidden" } }), evidence: () => [],
  }]);
  const result = await tools.execute("provider", {}, { executionId: "turn" });
  expect(result).toMatchObject({ ok: false, error: { retryable } });
  expect(JSON.stringify(result)).not.toContain("hidden");
});
it("validates the descriptor before calling the Provider port", async () => {
  const tools = new AgentToolRegistry(), operation = vi.fn(async () => ({ body: {} }));
  registerServerTools(tools, new ToolEvidenceRegistry(), [{ descriptor: {
    name: "provider", description: "provider", inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"], additionalProperties: false },
  }, operation, evidence: () => [] }]);
  expect(await tools.execute("provider", {}, { executionId: "turn" })).toMatchObject({ ok: false, error: { code: "invalid_input", retryable: false } });
  expect(operation).not.toHaveBeenCalled();
});

it("preserves typed errors and propagates cancellation/deadline to the operation", async () => {
  const tools = new AgentToolRegistry(), operation = vi.fn(async (_input, _context) => ({ statusCode: 409, body: { code: "stale_revision", message: "reload" } }));
  registerServerTools(tools, new ToolEvidenceRegistry(), [{ descriptor: { name: "read", description: "read", effect: "read", inputSchema: { type: "object", properties: {} } }, operation, evidence: () => [] }]);
  const controller = new AbortController();
  const result = await tools.execute("read", {}, { executionId: "turn", signal: controller.signal, deadlineAt: 1234 });
  expect(result).toEqual({ ok: false, error: { code: "stale_revision", message: "reload", retryable: false } });
  expect(operation.mock.calls[0]?.[1]).toMatchObject({ requestId: "turn", signal: controller.signal, deadlineAt: 1234 });
});
