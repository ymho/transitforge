import { describe, expect, it, vi } from "vitest";

import { createBedrockConverseOperation } from "./bedrock-converse.js";

describe("bedrock converse operation", () => {
  it("returns the response contract consumed by the frontend Agent Runtime", async () => {
    const converse = vi.fn(async () => ({
      message: { role: "assistant" as const, content: [{ text: "案内します" }] },
      stopReason: "end_turn" as const,
      metadata: { modelId: "model-1", latencyMs: 25, usage: { totalTokens: 16 } },
    }));
    const log = vi.fn();
    const operation = createBedrockConverseOperation({ converse }, log);
    const messages = [{ role: "user" as const, content: [{ text: "京都へ" }] }];

    const result = await operation({ messages }, { requestId: "request-1" });

    expect(converse).toHaveBeenCalledWith({ messages });
    expect(result.body).toEqual({
      message: { role: "assistant", content: [{ text: "案内します" }] },
      stopReason: "end_turn",
      metadata: { modelId: "model-1", latencyMs: 25, usage: { totalTokens: 16 } },
    });
    expect(log.mock.calls.map(([event]) => event)).toEqual([
      "bedrock_converse_started",
      "bedrock_converse_completed",
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("京都へ");
  });
});
