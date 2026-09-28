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
  expect(vi.mocked(StrandsAgentEngine).mock.calls.at(-1)?.[0]).not.toHaveProperty("novaReasoningEffort");
  expect(createStrandsServerRuntime).toHaveBeenCalledTimes(1);
  expect(createProductionConversationAgent).toHaveBeenLastCalledWith(expect.objectContaining({ runRuntime: expect.any(Function) }));
  createProductionServerAgent("v2-nova", { ...base, AGENT_RUNTIME_V2_ENABLED: "true", AWS_REGION: "ap-northeast-1" });
  expect(StrandsAgentEngine).toHaveBeenLastCalledWith(expect.objectContaining({
    modelId: "jp.amazon.nova-2-lite-v1:0", novaReasoningEffort: "low", maxOutputTokens: 4096, maxInvocationOutputTokens: 4096,
  }));
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

it("enables the OTP bridge only with one fully pinned graph deployment", () => {
  vi.mocked(createProductionConversationAgent).mockClear();
  const base = {
    SERVER_AGENT_MAX_EXECUTION_MS: "90000", AI_TIMETABLE_BUCKET: "source", TRAFFIC_SNAPSHOT_BUCKET: "test",
    AGENT_PROVIDER_SECRET_ARN: "test", VIEWER_ORIGIN: "https://example.com", SERVER_STATE_TABLE_NAME: "test",
    TRIP_TABLE_NAME: "test", FIXED_EGRESS_PROVIDER_FUNCTION_ARN: "test",
  };
  const version = "20260928T080000Z-123456789abc";
  const bridge = {
    OTP_ROUTE_PROVIDER_FUNCTION_ARN: "arn:aws:lambda:ap-northeast-1:123456789012:function:test-otp-bridge",
    OTP_GRAPH_MANIFEST_KEY: `otp/izumo-matsue/versions/${version}/manifest.json`, OTP_GRAPH_VERSION: version,
    OTP_EXPECTED_IMAGE: "docker.io/opentripplanner/opentripplanner@sha256:" + "b".repeat(64),
    OTP_EXPECTED_GRAPH_SHA: "a".repeat(64),
  };

  createProductionServerAgent("otp", { ...base, ...bridge });
  expect(createProductionConversationAgent).toHaveBeenCalledWith(expect.objectContaining({ tripGroundRoutes: expect.anything() }));
  expect(() => createProductionServerAgent("partial", { ...base, OTP_GRAPH_VERSION: version })).toThrow("Invalid OTP bridge configuration");
  expect(() => createProductionServerAgent("mixed", { ...base, ...bridge,
    OTP_GRAPHQL_ENDPOINT: "http://localhost:8080/otp/gtfs/v1",
    OTP_COVERAGE_JSON: JSON.stringify({ bounds: { south: 35, west: 132, north: 36, east: 133 },
      serviceStart: "2026-09-01", serviceEnd: "2026-10-31", feedUrl: "https://example.org/feed.zip",
      feedRetrievedAt: "2026-09-28T00:00:00Z", graphBuiltAt: "2026-09-28T01:00:00Z", attribution: "test" }),
  })).toThrow("Invalid OTP configuration");
});
