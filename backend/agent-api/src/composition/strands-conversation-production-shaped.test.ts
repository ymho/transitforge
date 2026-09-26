import { expect, it, vi } from "vitest";
import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { AgentToolDescriptor } from "@raiquora/agent/tool-contract";
import { stateDynamoFixture, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";

class ToolThenAnswerModel extends Model<BaseModelConfig> {
  private calls = 0;
  private config: BaseModelConfig = { modelId: "synthetic-strands" };

  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }

  async *stream(_messages: Message[], _options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.calls += 1;
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (this.calls === 1) {
      yield { type: "modelContentBlockStartEvent",
        start: { type: "toolUseStart", name: "lookup_verified_place", toolUseId: "lookup-1" } };
      yield { type: "modelContentBlockDeltaEvent",
        delta: { type: "toolUseInputDelta", input: JSON.stringify({ place: "京都" }) } };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
      return;
    }
    yield { type: "modelContentBlockStartEvent" };
    yield { type: "modelContentBlockDeltaEvent",
      delta: { type: "textDelta", text: "この自由文はEvidenceがあるため公開されない" } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
  }
}

it("runs an actual Strands model-tool-model loop inside the production-shaped Conversation path", async () => {
  const { verifier } = cognitoTokenFixture();
  const principal = await verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const { tripId: _tripId, ...consultationMetadata } = stateMetadata();
  await state.conversations.create(principal, conversationId, consultationMetadata);

  const operation = vi.fn(async () => ({ statusCode: 200, body: { place: "京都", verified: true } }));
  const descriptor: AgentToolDescriptor = {
    name: "lookup_verified_place",
    description: "検証済みの場所情報を取得する",
    effect: "read",
    inputSchema: { type: "object", properties: { place: { type: "string" } }, required: ["place"], additionalProperties: false },
  };
  const evidence = (_output: unknown, context: { executionId: string; toolCallId: string; toolName: string;
    queryFingerprint: string; retrievedAt: string }): Evidence[] => [{
    id: `evidence:${context.executionId}:place:kyoto`,
    category: "station",
    knowledgeKind: "deterministic_fact",
    subject: "京都",
    facts: { verified: true },
    references: [{ sourceType: "session-state", sourceRef: "verified:kyoto", retrievedAt: context.retrievedAt,
      freshness: "current", summary: "Toolで京都を検証済みです" }],
    observation: { observationId: `observation:${context.toolCallId}`, subjectKey: "place:kyoto",
      scopeKey: "conversation", predicate: "verified_place", retrievedAt: context.retrievedAt,
      applicability: "applicable", retention: "reference_only" },
  }];

  const engine = new StrandsAgentEngine({
    modelId: "unused",
    region: "ap-northeast-1",
    systemPrompt: "必要な事実はToolで確認してください。",
    maxTurns: 4,
  }, { model: new ToolThenAnswerModel() });
  const v1Model = { converse: vi.fn(async () => { throw new Error("V1 model must not run"); }) };

  const app = createConversationServerAgent({
    stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: v1Model,
    weather: { search: async () => { throw new Error("weather not used"); } },
    additionalTools: [{ descriptor, operation, evidence }],
    newExecutionId: () => "strands-production-shaped",
    runRuntime: createStrandsServerRuntime(engine),
  });

  const result = await app.runConversationTurn({
    principal,
    conversationId,
    turnId: secondId,
    userRequest: "京都について確認して",
  });

  expect(result.status).toBe("completed");
  expect(result.response).toContain("Toolで京都を検証済みです");
  expect(result.response).not.toContain("自由文");
  expect(result.delivery).toEqual({ status: "full", basis: "verified_projection" });
  expect(operation).toHaveBeenCalledTimes(1);
  expect(v1Model.converse).not.toHaveBeenCalled();
  expect((await state.conversations.history(principal, conversationId)).items.map(({ text }) => text))
    .toEqual(["京都について確認して", result.response]);
});
