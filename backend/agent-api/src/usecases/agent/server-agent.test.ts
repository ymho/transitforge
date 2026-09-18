import { describe, expect, it, vi } from "vitest";
import type { AgentModelRequest, AgentModelResponse } from "@raiquora/agent/model-provider";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { createServerAgentApplication } from "./server-agent.js";

const final: AgentModelResponse = { message: { role: "assistant", content: [{ type: "text", text: "こんにちは" }] }, stopReason: "completed", metadata: { provider: "fake" } };
const call: AgentModelResponse = { ...final, stopReason: "tool_calls", message: { role: "assistant", content: [{ type: "tool_call", name: "fake_tool", toolCallId: "call-1", input: {} }] } };
function setup(responses: AgentModelResponse[] = [call, final], maxExecutionMs = 1_000) {
  const requests: AgentModelRequest[] = [];
  const execute = vi.fn(async () => successfulAgentToolResult({ checked: true }));
  const app = createServerAgentApplication({ newExecutionId: () => "execution-1", limits: { maxExecutionMs },
    createModel: () => ({ generate: async request => { requests.push(structuredClone(request)); return responses.shift() ?? final; } }),
    registerTools: tools => tools.register({ name: "fake_tool", description: "fake", inputSchema: { type: "object", properties: {} },
      parseInput: value => validAgentToolInput(value), execute }),
  });
  return { app, requests, execute };
}
const input = { principal: { subject: "fake-principal" }, userRequest: "確認して" };

describe("Server Agent Application without Browser APIs", () => {
  it("completes model -> tool -> result -> model -> final with an ordered trace", async () => {
    const { app, requests, execute } = setup();
    const result = await app.runAgentTurn(input);
    expect(result.status).toBe("completed");
    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledOnce();
    expect(requests[1].messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", toolCallId: "call-1", status: "success", output: { checked: true } }] });
    const types = result.trace.events.map(event => event.type);
    expect(types.filter(type => ["model_completed", "tool_called", "tool_completed", "response_generated"].includes(type)))
      .toEqual(["model_completed", "tool_called", "tool_completed", "model_completed", "response_generated"]);
    expect(JSON.stringify(result.trace)).not.toContain("fake-principal");
  });
  it("does not execute duplicate calls", async () => {
    const { app, execute } = setup([call, { ...call, message: { ...call.message, content: [{ type: "tool_call", name: "fake_tool", toolCallId: "call-2", input: {} }] } }, final]);
    await app.runAgentTurn(input);
    expect(execute).toHaveBeenCalledOnce();
  });
  it("bounds a hung model and returns a failed/limit trace", async () => {
    const app = createServerAgentApplication({ newExecutionId: () => "timeout", registerTools: () => {},
      createModel: () => ({ generate: () => new Promise(() => {}) }), limits: { maxExecutionMs: 10 } });
    const result = await app.runAgentTurn(input);
    expect(["failed", "limit_reached"]).toContain(result.status);
    expect(result.trace.events.at(-1)?.type).toBe("task_completed");
  });
  it("validates principal and bounded input before constructing capabilities", async () => {
    const { app, execute, requests } = setup();
    await expect(app.runAgentTurn({ ...input, principal: { subject: "" } })).rejects.toThrow();
    await expect(app.runAgentTurn({ ...input, uiContext: { itemId: "a".repeat(201) } })).rejects.toThrow();
    await expect(app.runAgentTurn({ ...input, userRequest: "a".repeat(8001) })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled(); expect(requests).toEqual([]);
  });
  it("creates isolated capabilities for concurrent principals without promoting UI input to state", async () => {
    let id = 0;
    const scopes: unknown[] = [];
    const app = createServerAgentApplication({ newExecutionId: () => `turn-${++id}`,
      createModel: () => { let first = true; return { generate: async () => { if (first) { first = false; return call; } return final; } }; },
      registerTools: (tools, _evidence, scope) => {
        scopes.push(scope);
        tools.register({ name: "fake_tool", description: "fake", inputSchema: { type: "object", properties: {} },
          parseInput: validAgentToolInput, execute: async () => successfulAgentToolResult({ owner: scope.principal.subject }) });
      } });
    const results = await Promise.all(["owner-a", "owner-b"].map(subject => app.runAgentTurn({ ...input, principal: { subject },
      uiContext: { itemId: "item-1", ownerId: "untrusted" } as { itemId: string } })));
    expect(results.map(result => result.status)).toEqual(["completed", "completed"]);
    expect(JSON.stringify(scopes)).not.toContain("untrusted");
    expect(JSON.stringify(results[0])).not.toContain("owner-b");
    expect(JSON.stringify(results[1])).not.toContain("owner-a");
  });
});
