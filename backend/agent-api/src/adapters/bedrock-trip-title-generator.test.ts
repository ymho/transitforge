import { expect, it, vi } from "vitest";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockTripTitleGenerator } from "./bedrock-trip-title-generator.js";
it("uses one bounded model call with current itinerary names", async () => {
  const client = new BedrockRuntimeClient({});
  const send = vi.spyOn(client, "send").mockResolvedValue({ stopReason: "end_turn", output: { message: { content: [{ text: "出雲の町歩き" }] } } } as never);
  const generator = new BedrockTripTitleGenerator("test-model", client);
  expect(await generator.generate([{ type: "activity", title: "出雲大社" }])).toBe("出雲の町歩き");
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![0].input).toMatchObject({ modelId: "test-model", inferenceConfig: { maxTokens: 120 }, messages: [{ role: "user", content: [{ text: '[{"type":"activity","title":"出雲大社"}]' }] }] });
});
it.each(["", "説明\nタイトル", "長".repeat(33)])("rejects malformed output instead of storing it: %s", async text => {
  const client = new BedrockRuntimeClient({}); vi.spyOn(client, "send").mockResolvedValue({ stopReason: "end_turn", output: { message: { content: [{ text }] } } } as never);
  await expect(new BedrockTripTitleGenerator("model", client).generate([{ type: "activity", title: "町" }])).rejects.toThrow();
});
