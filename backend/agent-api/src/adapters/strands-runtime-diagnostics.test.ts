import { expect, it } from "vitest";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { ServerAgentRuntimeExecutionError } from "../ports/server-agent-runtime.js";
import { StrandsAgentEngine } from "./strands-agent-engine.js";

it("wraps an SDK/provider invoke throw into bounded runtime metadata without retaining its message", async () => {
  const error = new Error("PRIVATE_PROVIDER_DETAIL");
  error.name = "ServiceUnavailableException";
  const tools = new AgentToolRegistry();
  const evidence = new ToolEvidenceRegistry();
  const engine = new StrandsAgentEngine({
    modelId: "unused", region: "ap-northeast-1", systemPrompt: "test", maxTurns: 2,
  }, { createAgent: () => ({ invoke: async () => { throw error; } }) });
  const executor = new AgentToolExecutor(tools, evidence);
  let caught: unknown;
  try {
    await engine.run({ executionId: "runtime-diagnostics", userRequest: "PRIVATE_REQUEST", tools, toolExecutor: executor });
  } catch (value) { caught = value; }
  expect(caught).toBeInstanceOf(ServerAgentRuntimeExecutionError);
  expect(caught).toMatchObject({ stage: "agent_invoke", kind: "provider" });
  expect(String(caught)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  expect(String(caught)).not.toContain("PRIVATE_REQUEST");
});
