import { describe, expect, it, vi } from "vitest";

it("does not retain earlier Profile text echoed in conversation after consent removal", async () => {
  const record = vi.fn(async () => undefined);
  const converse = vi.fn(async () => ({ output: { message: { role: "assistant", content: [{ text: "回答" }] } }, stopReason: "end_turn" }));
  const model = new BedrockConversationModel({ converse }, { modelId: "model-1", systemPrompt: "system", traceRecorder: { record } });
  await model.converse({ messages: [{ role: "user", content: [{ text: `<agent_context>${JSON.stringify({ conversation: { messages: [{ role: "assistant", text: "earlier-private-preference" }] } })}</agent_context>` }] }],
    trace: { modelCallId: "model-2", apiRequestId: "request-2" } });
  expect(JSON.stringify(converse.mock.calls)).toContain("earlier-private-preference");
  expect(JSON.stringify(record.mock.calls)).not.toContain("earlier-private-preference");
});

it("sends opted-in preferences to the model but omits conversation content from its Trace", async () => {
  const record = vi.fn(async () => undefined), log = vi.fn();
  const converse = vi.fn(async () => ({ output: { message: { role: "assistant", content: [{ text: "回答" }] } }, stopReason: "end_turn" }));
  const model = new BedrockConversationModel({ converse }, { modelId: "model-1", systemPrompt: "system", traceRecorder: { record }, log });
  await model.converse({ messages: [{ role: "user", content: [{ text: JSON.stringify({ travelProfile: { consentedPreferenceNotes: { food: "private-food-note" } } }) }] }],
    trace: { modelCallId: "model-1", apiRequestId: "request-1" } });
  expect(JSON.stringify(converse.mock.calls)).toContain("private-food-note");
  expect(JSON.stringify(record.mock.calls)).not.toContain("private-food-note");
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-food-note");
  expect(record.mock.calls[0]).toBeDefined();
});

import type { JsonObject } from "../contracts/agent-request.js";
import { validatedToolDefinitions } from "../contracts/agent-request.js";
import {
  BedrockConversationModel,
  validateBedrockModelId,
} from "./bedrock-conversation-model.js";

describe("BedrockConversationModel", () => {
  it("relays long validated descriptions to Converse without losing trailing constraints", async () => {
    const description = "能力と適用条件の説明。".repeat(500) + "境界: 未確認情報を断定しない";
    const converse = vi.fn(async (_input: JsonObject) => ({
      output: { message: { role: "assistant", content: [{ text: "確認します" }] } }, stopReason: "end_turn",
    }));
    const model = new BedrockConversationModel({ converse }, { modelId: "amazon.nova-lite-v1:0", systemPrompt: "system" });
    await model.converse({
      messages: [{ role: "user", content: [{ text: "旅行を相談したい" }] }],
      tools: validatedToolDefinitions({ toolDefinitions: [{
        name: "search_journeys", description, inputSchema: { type: "object", properties: {} },
      }] }),
    });
    expect(converse.mock.calls[0]?.[0]).toMatchObject({ toolConfig: { tools: [{ toolSpec: { description } }] } });
  });

  it("allows a measured output budget while retaining provider limits", async () => {
    const converse = vi.fn(async (_input: JsonObject) => ({
      output: { message: { role: "assistant", content: [{ text: "候補の比較と理由".repeat(700) }] } },
      stopReason: "end_turn",
    }));
    const model = new BedrockConversationModel({ converse }, {
      modelId: "amazon.nova-lite-v1:0", systemPrompt: "system", maxOutputTokens: 4_096,
    });
    const result = await model.converse({ messages: [{ role: "user", content: [{ text: "候補を比較して" }] }] });
    expect(result.stopReason).toBe("end_turn");
    expect(converse.mock.calls[0]?.[0].inferenceConfig).toEqual({ maxTokens: 4_096, temperature: 0 });
    expect(() => new BedrockConversationModel({ converse }, {
      modelId: "model", systemPrompt: "system", maxOutputTokens: 5_001,
    })).toThrow("maxOutputTokens");
  });

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
      inferenceConfig: { maxTokens: 4_096, temperature: 0 },
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
        inferenceConfig: { maxTokens: 4_096, temperature: 0 },
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
