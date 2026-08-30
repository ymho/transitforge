import { describe, expect, it, vi } from "vitest";

import {
  failedAgentToolResult,
  invalidAgentToolInput,
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentTool,
} from "./tool-contract";
import {
  AgentToolRegistrationError,
  AgentToolRegistry,
} from "./tool-registry";

interface EchoInput {
  value: string;
}

type EchoTool = AgentTool<EchoInput, { value: string }>;

const echoTool = (
  execute: EchoTool["execute"] = async ({ value }) =>
    successfulAgentToolResult({ value }),
): EchoTool => ({
  name: "echo_value",
  description: "検証済みの値を返す",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
  parseInput: (value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("value" in value) ||
      typeof value.value !== "string"
    ) {
      return invalidAgentToolInput("valueは文字列で指定してください");
    }
    return validAgentToolInput({ value: value.value });
  },
  execute,
});

describe("AgentToolRegistry", () => {
  it("compiles decision support into the model-facing capability description", () => {
    const registry = new AgentToolRegistry();
    registry.register({
      ...echoTool(),
      decisionSupport: {
        capability: "検証済みの経路を検索する",
        suitableCases: ["駅間移動"],
        unsuitableCases: ["宿泊検索"],
        returnedEvidence: "時刻表Evidence",
        freshness: "指定日ダイヤ",
        limitations: ["運賃は対象外"],
        responsibilityBoundary: "経路計算はTool、推薦はAgent",
      },
    });

    expect(registry.descriptors()[0]?.description).toContain("能力: 検証済みの経路");
    expect(registry.descriptors()[0]?.description).toContain("適さない: 宿泊検索");
    expect(registry.descriptors()[0]?.description).toContain("境界: 経路計算はTool");
    expect(registry.descriptors()[0]?.description.length).toBeLessThanOrEqual(500);
  });
  const context = { executionId: "execution-1" };

  it("executes a registered tool only after validating its input", async () => {
    const execute = vi.fn(async ({ value }: EchoInput) =>
      successfulAgentToolResult({ value }));
    const registry = new AgentToolRegistry();
    registry.register(echoTool(execute));

    await expect(registry.execute("echo_value", { value: "京都" }, context))
      .resolves.toEqual({ ok: true, output: { value: "京都" } });
    expect(execute).toHaveBeenCalledWith({ value: "京都" }, context);
  });

  it("returns an explicit error for invalid input without executing the tool", async () => {
    const execute = vi.fn(async ({ value }: EchoInput) =>
      successfulAgentToolResult({ value }));
    const registry = new AgentToolRegistry();
    registry.register(echoTool(execute));

    await expect(registry.execute("echo_value", { value: 1 }, context))
      .resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects unknown and duplicate tools", async () => {
    const registry = new AgentToolRegistry();
    registry.register(echoTool());

    await expect(registry.execute("missing_tool", {}, context))
      .resolves.toMatchObject({ ok: false, error: { code: "unknown_tool" } });
    expect(() => registry.register(echoTool())).toThrowError(
      AgentToolRegistrationError,
    );

    const invalidName = echoTool();
    invalidName.name = "Bedrock Tool";
    expect(() => new AgentToolRegistry().register(invalidName)).toThrowError(
      AgentToolRegistrationError,
    );
  });

  it("keeps a tool failure and sanitizes an unexpected exception", async () => {
    const domainFailure = echoTool(async () => failedAgentToolResult({
      code: "execution_failed",
      message: "検索入力を読み込めませんでした",
      retryable: true,
    }));
    const throwingTool = echoTool(async () => {
      throw new Error("secret-value");
    });
    throwingTool.name = "throw_value";
    const registry = new AgentToolRegistry();
    registry.register(domainFailure);
    registry.register(throwingTool);

    await expect(registry.execute("echo_value", { value: "x" }, context))
      .resolves.toMatchObject({
        ok: false,
        error: { message: "検索入力を読み込めませんでした", retryable: true },
      });
    const thrown = await registry.execute("throw_value", { value: "x" }, context);
    expect(thrown).toMatchObject({
      ok: false,
      error: { code: "execution_failed", retryable: false },
    });
    expect(JSON.stringify(thrown)).not.toContain("secret-value");
  });

  it("exposes provider-independent descriptors in registration order", () => {
    const registry = new AgentToolRegistry();
    registry.register(echoTool());

    expect(registry.descriptors()).toEqual([{
      name: "echo_value",
      description: "検証済みの値を返す",
      inputSchema: echoTool().inputSchema,
    }]);
  });
});
