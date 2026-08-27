import { describe, expect, it, vi } from "vitest";

import type { JsonObject } from "../contracts/agent-request.js";
import { BedrockConversationModel } from "./bedrock-conversation-model.js";

describe("BedrockConversationModel", () => {
  it("keeps provider DTOs inside the adapter and normalizes metadata", async () => {
    const converse = vi.fn(async (_input: JsonObject) => ({
      output: {
        message: {
          role: "assistant",
          content: [{ toolUse: { toolUseId: "tool-1", name: "search_journeys", input: { originStation: "京都" } } }],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 12.9, outputTokens: 4, totalTokens: 16, ignored: 99 },
      metrics: { latencyMs: 25.4 },
    }));
    const model = new BedrockConversationModel({ converse }, {
      modelId: "amazon.nova-lite-v1:0",
      systemPrompt: "system",
      now: () => 100,
    });

    const result = await model.converse({
      messages: [{ role: "user", content: [{ text: "京都から大阪まで" }] }],
      tools: [{
        name: "search_journeys",
        description: "時刻表から経路を検索する",
        inputSchema: {
          type: "object",
          properties: { originStation: { type: "string" } },
          required: ["originStation"],
          additionalProperties: false,
        },
      }],
    });

    expect(converse).toHaveBeenCalledWith({
      modelId: "amazon.nova-lite-v1:0",
      system: [{ text: "system" }],
      messages: [{ role: "user", content: [{ text: "京都から大阪まで" }] }],
      toolConfig: { tools: [{ toolSpec: {
        name: "search_journeys",
        description: "時刻表から経路を検索する",
        inputSchema: { json: {
          type: "object",
          properties: { originStation: { type: "string" } },
          required: ["originStation"],
        } },
      } }] },
      inferenceConfig: { maxTokens: 500, temperature: 0 },
    });
    expect(result).toEqual({
      message: { role: "assistant", content: [{ toolUse: { toolUseId: "tool-1", name: "search_journeys", input: { originStation: "京都" } } }] },
      stopReason: "tool_use",
      metadata: {
        modelId: "amazon.nova-lite-v1:0",
        latencyMs: 25,
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      },
    });
  });

  it("rejects unexpected provider output and enforces the adapter timeout", async () => {
    const invalid = new BedrockConversationModel({ converse: async () => ({ stopReason: "end_turn" }) }, {
      modelId: "model-1",
      systemPrompt: "system",
    });
    await expect(invalid.converse({ messages: [] })).rejects.toThrow("unexpected response");

    const timeout = new BedrockConversationModel({ converse: () => new Promise(() => undefined) }, {
      modelId: "model-1",
      systemPrompt: "system",
      timeoutMs: 1,
    });
    await expect(timeout.converse({ messages: [] })).rejects.toThrow("timed out");
  });
});
