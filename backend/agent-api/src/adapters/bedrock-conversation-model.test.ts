import { describe, expect, it, vi } from "vitest";

import type { JsonObject } from "../contracts/agent-request.js";
import {
  BedrockConversationModel,
  validateBedrockModelId,
} from "./bedrock-conversation-model.js";

describe("BedrockConversationModel", () => {
  it("omits Bedrock toolConfig when no tools are available", async () => {
    const converse = vi.fn(async (_input: JsonObject) => ({
      output: { message: { role: "assistant", content: [{ text: "案内します" }] } },
      stopReason: "end_turn",
    }));
    const model = new BedrockConversationModel({ converse }, {
      modelId: "amazon.nova-lite-v1:0",
      systemPrompt: "system",
    });

    await model.converse({
      messages: [{ role: "user", content: [{ text: "案内して" }] }],
      tools: [],
    });

    expect(converse).toHaveBeenCalledOnce();
    expect(converse.mock.calls[0]?.[0]).not.toHaveProperty("toolConfig");
  });

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

  it("records the exact provider request and failure diagnostic", async () => {
    const providerError = Object.assign(new Error("messages are invalid"), {
      name: "ValidationException",
      $metadata: { httpStatusCode: 400, requestId: "provider-request-1" },
      $retryable: {},
    });
    const record = vi.fn(async () => undefined);
    const model = new BedrockConversationModel({
      converse: async () => Promise.reject(providerError),
    }, {
      modelId: "model-1",
      systemPrompt: "system prompt",
      traceRecorder: { record },
    });

    await expect(model.converse({
      messages: [{ role: "user", content: [{ text: "海へ行きたい" }] }],
      modelClass: "decision",
      trace: { modelCallId: "execution-1:model:1", apiRequestId: "api-request-1" },
    })).rejects.toBe(providerError);

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      modelCallId: "execution-1:model:1",
      apiRequestId: "api-request-1",
      providerRequest: {
        modelId: "model-1",
        system: [{ text: "system prompt" }],
        messages: [{ role: "user", content: [{ text: "海へ行きたい" }] }],
        inferenceConfig: { maxTokens: 500, temperature: 0 },
      },
      outcome: {
        status: "failed",
        error: {
          name: "ValidationException",
          message: "messages are invalid",
          statusCode: 400,
          providerRequestId: "provider-request-1",
          retryable: false,
        },
      },
    }));
  });

  it("does not fail a successful model call when trace storage fails", async () => {
    const log = vi.fn();
    const model = new BedrockConversationModel({ converse: async () => ({
      output: { message: { role: "assistant", content: [{ text: "案内します" }] } },
      stopReason: "end_turn",
    }) }, {
      modelId: "model-1",
      systemPrompt: "system",
      traceRecorder: { record: async () => Promise.reject(new Error("S3 unavailable")) },
      log,
    });

    await expect(model.converse({
      messages: [{ role: "user", content: [{ text: "案内して" }] }],
      trace: { modelCallId: "execution-1:model:1", apiRequestId: "api-request-1" },
    })).resolves.toMatchObject({ stopReason: "end_turn" });
    expect(log).toHaveBeenCalledWith("agent_model_call_trace_store_failed", {
      modelCallId: "execution-1:model:1",
      requestId: "api-request-1",
      outcome: "completed",
    });
  });

  it("rejects unexpected provider output and enforces the adapter timeout", async () => {
    const invalid = new BedrockConversationModel({ converse: async () => ({ stopReason: "end_turn" }) }, {
      modelId: "model-1",
      systemPrompt: "system",
    });
    await expect(invalid.converse({ messages: [] })).rejects.toThrow("missing output.message");

    const timeout = new BedrockConversationModel({ converse: () => new Promise(() => undefined) }, {
      modelId: "model-1",
      systemPrompt: "system",
      timeoutMs: 1,
    });
    await expect(timeout.converse({ messages: [] })).rejects.toThrow("timed out");
  });

  it("selects configured model classes and falls back to the default model", async () => {
    const selectedModelIds: unknown[] = [];
    const converse = vi.fn(async (input: JsonObject) => {
      selectedModelIds.push(input.modelId);
      return {
      output: { message: { role: "assistant", content: [{ text: "ok" }] } },
      stopReason: "end_turn",
      };
    });
    const model = new BedrockConversationModel({ converse }, {
      modelId: "provider.default-v1:0",
      lightweightModelId: "provider.light-v1:0",
      decisionModelId: "provider.decision-v1:0",
      systemPrompt: "system",
    });

    await model.converse({ messages: [], modelClass: "lightweight" });
    await model.converse({ messages: [], modelClass: "decision" });
    await model.converse({ messages: [], modelClass: "default" });

    expect(selectedModelIds).toEqual([
      "provider.light-v1:0",
      "provider.decision-v1:0",
      "provider.default-v1:0",
    ]);
  });

  it("validates Bedrock model IDs without fixing the vendor", () => {
    expect(validateBedrockModelId("anthropic.claude-3-5-sonnet-v2:0"))
      .toBe("anthropic.claude-3-5-sonnet-v2:0");
    expect(validateBedrockModelId("amazon.nova-lite-v1:0"))
      .toBe("amazon.nova-lite-v1:0");
    expect(() => validateBedrockModelId("model id\nINJECT"))
      .toThrow("invalid");
  });
});
