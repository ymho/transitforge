import { describe, expect, it, vi } from "vitest";

import { BedrockModelProvider } from "./bedrock-model-provider";

describe("Bedrock model provider adapter", () => {
  it("converts provider-independent messages tools and metadata", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({
        messages: [{
          role: "user",
          content: [{ text: "京都から大阪まで" }],
        }],
        toolDefinitions: [{
          name: "search_journeys",
          inputSchema: { type: "object" },
        }],
      });
      return Response.json({
        message: {
          role: "assistant",
          content: [{
            toolUse: {
              toolUseId: "tool-1",
              name: "search_journeys",
              input: { originStation: "京都", destinationStation: "大阪" },
            },
          }],
        },
        stopReason: "tool_use",
        metadata: {
          modelId: "model-1",
          latencyMs: 125,
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      }, { headers: { "x-transitforge-request-id": "request-1" } });
    });
    const provider = new BedrockModelProvider(fetcher);

    const result = await provider.generate({
      messages: [{
        role: "user",
        content: [{ type: "text", text: "京都から大阪まで" }],
      }],
      tools: [{
        name: "search_journeys",
        description: "経路を検索する",
        inputSchema: {
          type: "object",
          properties: { originStation: { type: "string" } },
          additionalProperties: false,
        },
      }],
    });

    expect(result).toEqual({
      message: {
        role: "assistant",
        content: [{
          type: "tool_call",
          toolCallId: "tool-1",
          name: "search_journeys",
          input: { originStation: "京都", destinationStation: "大阪" },
        }],
      },
      stopReason: "tool_calls",
      metadata: {
        provider: "bedrock",
        requestId: "request-1",
        model: "model-1",
        latencyMs: 125,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      },
    });
  });

  it("converts generic tool results without leaking their shape outside the adapter", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.messages[0].content[0]).toEqual({
        toolResult: {
          toolUseId: "tool-1",
          status: "success",
          content: [{ json: { journeys: [] } }],
        },
      });
      return Response.json({
        message: { role: "assistant", content: [{ text: "候補はありません" }] },
        stopReason: "end_turn",
      });
    });
    const provider = new BedrockModelProvider(fetcher);

    const result = await provider.generate({
      messages: [{
        role: "user",
        content: [{
          type: "tool_result",
          toolCallId: "tool-1",
          status: "success",
          output: { journeys: [] },
        }],
      }],
    });

    expect(result.message.content).toEqual([
      { type: "text", text: "候補はありません" },
    ]);
    expect(result.stopReason).toBe("completed");
  });

  it("keeps concurrent request metadata separate", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const text = JSON.parse(String(init?.body)).messages[0].content[0].text;
      return Response.json({
        message: { role: "assistant", content: [{ text }] },
        stopReason: "end_turn",
      }, { headers: { "x-transitforge-request-id": `request-${text}` } });
    });
    const provider = new BedrockModelProvider(fetcher);
    const request = (text: string) => ({
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text }] }],
    });

    const [first, second] = await Promise.all([
      provider.generate(request("a")),
      provider.generate(request("b")),
    ]);

    expect(first.metadata.requestId).toBe("request-a");
    expect(second.metadata.requestId).toBe("request-b");
  });
});
