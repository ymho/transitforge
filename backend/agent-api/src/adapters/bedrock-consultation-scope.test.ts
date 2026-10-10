import { expect, it, vi } from "vitest";
import type { ConverseCommandOutput, ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { BedrockConsultationScope } from "./bedrock-consultation-scope.js";
const response = (scope: string): ConverseCommandOutput => ({
  $metadata: {}, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 }, stopReason: "tool_use", output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "scope", name: "classify_consultation", input: { scope } } }] } },
});
it.each(["travel", "out-of-scope"] as const)("accepts only a structured scope decision: %s", async scope => {
  const invoke = vi.fn(async (_input: ConverseCommandInput) => response(scope));
  expect(await new BedrockConsultationScope("model", invoke).classify("積分の公式を教えて")).toBe(scope);
  expect(invoke.mock.calls[0]?.[0]).toMatchObject({ messages: [{ role: "user", content: [{ text: "積分の公式を教えて" }] }],
    toolConfig: { toolChoice: { tool: { name: "classify_consultation" } } } });
});
it("fails closed on prose, malformed classifications, truncation and provider errors", async () => {
  for (const result of [response("unknown"), { ...response("travel"), stopReason: "max_tokens" as const },
    { $metadata: {}, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 }, stopReason: "end_turn" as const, output: { message: { role: "assistant" as const, content: [{ text: "travel" }] } } }]) {
    await expect(new BedrockConsultationScope("model", async () => result).classify("旅行したい")).rejects.toThrow();
  }
  await expect(new BedrockConsultationScope("model", async () => { throw new Error("provider unavailable"); }).classify("積分の公式を教えて")).rejects.toThrow("provider unavailable");
});
