import { expect, it, vi } from "vitest";
import { createProductionServerAgent } from "./production-server-agent-composition.js";
import { createProductionConversationAgent } from "./composition/production-conversation-agent.js";
import { StrandsAgentEngine } from "./adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "./adapters/strands-server-runtime.js";
import { agentV2SystemPrompt } from "./usecases/agent-v2-system-prompt.js";
vi.mock("./composition/production-conversation-agent.js", () => ({ createProductionConversationAgent: vi.fn() }));
vi.mock("./adapters/strands-agent-engine.js", () => ({ StrandsAgentEngine: vi.fn(function () {}) }));
vi.mock("./adapters/strands-server-runtime.js", () => ({ createStrandsServerRuntime: vi.fn(() => vi.fn()) }));
it("passes the validated business deadline to the production stateful Runtime", () => {
  createProductionServerAgent("test", {
    SERVER_AGENT_MAX_EXECUTION_MS: "90000", AI_TIMETABLE_BUCKET: "test", TRAFFIC_SNAPSHOT_BUCKET: "test",
    AGENT_PROVIDER_SECRET_ARN: "test", VIEWER_ORIGIN: "https://example.com", SERVER_STATE_TABLE_NAME: "test",
    TRIP_TABLE_NAME: "test", FIXED_EGRESS_PROVIDER_FUNCTION_ARN: "test",
  });
  expect(createProductionConversationAgent).toHaveBeenCalledWith(expect.objectContaining({
    limits: { maxIterations: 10, maxModelCalls: 14, maxToolCalls: 16, maxExecutionMs: 90000 },
  }));
});


it("keeps Strands disabled by default and enables it only through trusted production configuration", () => {
  vi.mocked(createProductionConversationAgent).mockClear();
  vi.mocked(StrandsAgentEngine).mockClear();
  vi.mocked(createStrandsServerRuntime).mockClear();
  const base = {
    SERVER_AGENT_MAX_EXECUTION_MS: "90000", AI_TIMETABLE_BUCKET: "test", TRAFFIC_SNAPSHOT_BUCKET: "test",
    AGENT_PROVIDER_SECRET_ARN: "test", VIEWER_ORIGIN: "https://example.com", SERVER_STATE_TABLE_NAME: "test",
    TRIP_TABLE_NAME: "test", FIXED_EGRESS_PROVIDER_FUNCTION_ARN: "test",
  };

  createProductionServerAgent("v1", base);
  expect(StrandsAgentEngine).not.toHaveBeenCalled();
  expect(createStrandsServerRuntime).not.toHaveBeenCalled();
  expect(createProductionConversationAgent).toHaveBeenLastCalledWith(expect.not.objectContaining({ runRuntime: expect.anything() }));

  createProductionServerAgent("v2", { ...base, AGENT_RUNTIME_V2_ENABLED: "true", AWS_REGION: "ap-northeast-1", MODEL_ID: "test-model" });
  expect(StrandsAgentEngine).toHaveBeenCalledWith(expect.objectContaining({
    modelId: "test-model", region: "ap-northeast-1", maxTurns: 10, maxOutputTokens: 4096,
    systemPrompt: agentV2SystemPrompt,
  }));
  expect(createStrandsServerRuntime).toHaveBeenCalledTimes(1);
  expect(createProductionConversationAgent).toHaveBeenLastCalledWith(expect.objectContaining({ runRuntime: expect.any(Function) }));
});

it("rejects an invalid Strands production flag and requires a real AWS region when enabled", () => {
  const base = {
    SERVER_AGENT_MAX_EXECUTION_MS: "90000",
    AI_TIMETABLE_BUCKET: "test", TRAFFIC_SNAPSHOT_BUCKET: "test", AGENT_PROVIDER_SECRET_ARN: "test",
    VIEWER_ORIGIN: "https://example.com", SERVER_STATE_TABLE_NAME: "test", TRIP_TABLE_NAME: "test",
    FIXED_EGRESS_PROVIDER_FUNCTION_ARN: "test",
  };
  expect(() => createProductionServerAgent("bad", { ...base, AGENT_RUNTIME_V2_ENABLED: "yes" })).toThrow("Invalid server configuration");
  expect(() => createProductionServerAgent("missing-region", { ...base, AGENT_RUNTIME_V2_ENABLED: "true" })).toThrow("Missing server configuration");
});
