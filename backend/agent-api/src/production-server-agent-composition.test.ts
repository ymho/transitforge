import { expect, it, vi } from "vitest";
import { createProductionServerAgent } from "./production-server-agent-composition.js";
import { createProductionConversationAgent } from "./composition/production-conversation-agent.js";
vi.mock("./composition/production-conversation-agent.js", () => ({ createProductionConversationAgent: vi.fn() }));
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
