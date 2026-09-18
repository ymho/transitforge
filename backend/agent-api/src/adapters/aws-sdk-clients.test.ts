import { afterEach, expect, it, vi } from "vitest";
import { BedrockRuntimeClient, ConverseCommand, CountTokensCommand } from "@aws-sdk/client-bedrock-runtime";
import { AwsBedrockConverseClient } from "./aws-sdk-clients";

afterEach(() => vi.restoreAllMocks());

it("counts only the explicit diagnostic request without changing production inference", async () => {
  const send = vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({ inputTokens: 123 } as never);
  const client = new AwsBedrockConverseClient();
  const input = { modelId: "amazon.nova-lite-v1:0", messages: [{ role: "user", content: [{ text: "synthetic" }] }],
    system: [{ text: "synthetic contract" }], toolConfig: { tools: [] }, inferenceConfig: { temperature: 0, maxTokens: 4096 } };
  await client.converse(input);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0]).toBeInstanceOf(ConverseCommand);
  expect(send.mock.calls[0]![0].input).toEqual(input);
  expect(await client.countTokens(input)).toBe(123);
  expect(send.mock.calls[1]![0]).toBeInstanceOf(CountTokensCommand);
  expect(send.mock.calls[1]![0].input).toEqual({ modelId: input.modelId,
    input: { converse: { messages: input.messages, system: input.system, toolConfig: input.toolConfig } } });
});

it("does not infer a token count or retry when diagnostics are unavailable", async () => {
  const error = new Error("synthetic unavailable");
  const send = vi.spyOn(BedrockRuntimeClient.prototype, "send").mockRejectedValue(error);
  await expect(new AwsBedrockConverseClient().countTokens({ modelId: "amazon.nova-lite-v1:0", messages: [] })).rejects.toBe(error);
  expect(send).toHaveBeenCalledTimes(1);
});
