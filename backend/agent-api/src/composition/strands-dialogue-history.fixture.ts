import type { Model, BaseModelConfig } from "@strands-agents/sdk";
import { createTrip } from "@raiquora/trip/trip";
import { stateDynamoFixture, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { StrandsAgentEngine, type StrandsAgentFactory } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

export const dialogueMessages = [
  "全体で3人です。同行者のうち10代の大学生1人と20代の大学生1人が全行程に参加します。",
  "出発地は大阪にします。大学生のうち1人は2日目まで参加して帰りますが、どちらかはまだ決まっていません。",
  "10代の方です。",
  "逆でした。",
  "もし20代の大学生も全行程に参加できるならどうですか。今の条件は変えずに考えてください。",
  "同行者の詳細条件はいったん未定に戻して。全体人数と出発地はそのままです。",
] as const;

/** The deterministic and live tests use the SAME authenticated Conversation path.
 * History and scopes are loaded from repositories, never reconstructed by the test
 * and never substituted for persisted Intent. No external Provider or AWS state. */
export async function dialogueHistoryFixture(dependencies: { model?: Model<BaseModelConfig>; createAgent?: StrandsAgentFactory } = {}) {
  const principal = await cognitoTokenFixture().verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const trip = createTrip("72910000-0000-4000-8000-000000000001", "同行者の相談", "2026-09-27T00:00:00Z", [],
    { constraints: [], assumptions: [] }, "inspiration", undefined,
    { version: 1, logicalDays: [{ id: "day-a" }, { id: "day-b" }, { id: "day-c" }], calendarBindings: [] });
  trips.seed(trip, principal.subject);
  await state.conversations.create(principal, conversationId, { ...stateMetadata(), tripId: trip.id });
  let writerCallbacks = 0;
  const runtime = createStrandsServerRuntime(new StrandsAgentEngine({
    modelId: process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0", region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
    maxOutputTokens: 1536, maxInvocationOutputTokens: 4096,
  }, dependencies));
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: { converse: async () => { throw new Error("V1 must not run"); } },
    weather: { search: async () => { throw new Error("No external Provider in this fixture"); } },
    newExecutionId: () => "synthetic-dialogue-history",
    limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
    runRuntime: input => runtime({ ...input, ...(input.conditionController ? { conditionController: {
      ...input.conditionController, apply: change => { writerCallbacks++; return input.conditionController!.apply(change); },
    } } : {}) }),
  });
  const turns = new DynamoDbConversationTurnRepository("test-state", state.client);
  const input = (index: number) => ({ principal, conversationId, turnId: `72910000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
    userRequest: dialogueMessages[index]! });
  return { state, trips, trip, principal, app, input, get writerCallbacks() { return writerCallbacks; },
    overlay: async () => (await turns.getWorkingState(principal, conversationId))?.semantic?.overlay,
    history: () => state.conversations.history(principal, conversationId),
  };
}
