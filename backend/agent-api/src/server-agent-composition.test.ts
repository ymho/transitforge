import { expect, it, vi } from "vitest";
import { BedrockConversationModel } from "./adapters/bedrock-conversation-model.js";
import { createServerAgent } from "./server-agent-composition.js";
import type { JsonObject } from "./contracts/agent-request.js";
import type { WeatherForecastProvider } from "./ports/weather-provider.js";

it("runs the existing Bedrock adapter, backend weather operation and another registered Tool in one process", async () => {
  const converse = vi.fn(async (_request: JsonObject) => converse.mock.calls.length === 1
    ? { output: { message: { role: "assistant", content: [
      { toolUse: { toolUseId: "weather-call", name: "search_weather_forecast", input: { location: "京都市" } } },
      { toolUse: { toolUseId: "extra-call", name: "search_web", input: {} } },
    ] } }, stopReason: "tool_use" }
    : { output: { message: { role: "assistant", content: [{ text: "<decision_summary>" + JSON.stringify({ interpretedGoal: "天気確認", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["evidence_sufficient"], usedEvidenceIds: ["weather-evidence"] }) + "</decision_summary>確認した情報を案内します。" }] } }, stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
  const search = vi.fn<WeatherForecastProvider["search"]>(async () => ({
    status: "available", freshness: "fresh", evidence: [{ id: "weather-evidence", kind: "weather", provider: "fixture-weather",
      sourceUrl: "https://example.test/weather", retrievedAt: "2026-09-18T00:00:00Z", confidence: "provider-forecast" }],
  }));
  const extra = vi.fn(async () => ({ body: { checked: true } }));
  const app = createServerAgent({
    model: new BedrockConversationModel({ converse }, { modelId: "test-model", decisionModelId: "test-decision", systemPrompt: "existing backend system prompt" }),
    weather: { search }, newExecutionId: () => "server-turn",
    additionalTools: [{ descriptor: { name: "search_web", description: "test additional capability", inputSchema: { type: "object", properties: {} } },
      operation: extra, evidence: () => [] }],
  });
  const result = await app.runAgentTurn({ principal: { subject: "trusted-fake" }, userRequest: "京都の天気を調べて" });
  expect(result.status, JSON.stringify(result.trace)).toBe("completed");
  expect(search).toHaveBeenCalledExactlyOnceWith({ location: "京都市" });
  expect(extra).toHaveBeenCalledOnce();
  expect(converse).toHaveBeenCalledTimes(2);
  expect(converse.mock.calls[0][0]).toMatchObject({ modelId: "test-decision", system: [{ text: "existing backend system prompt" }] });
  expect(JSON.stringify(converse.mock.calls[1][0])).toContain("weather-evidence");
  expect(JSON.stringify(converse.mock.calls[1][0])).toContain("weather-call");
  expect(result.evidence.map(e => e.id)).toEqual(["weather-evidence"]);
  expect(result.claims[0]).toMatchObject({ evidenceIds: ["weather-evidence"], groundingStatus: "supported" });
  expect(result.trace.events).toContainEqual(expect.objectContaining({ type: "model_completed", model: "test-decision" }));
});
