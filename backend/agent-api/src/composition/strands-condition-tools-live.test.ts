import { describe, expect, it, vi } from "vitest";
import { Agent, ModelMessageEvent } from "@strands-agents/sdk";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";
import { validAgentToolInput, successfulAgentToolResult } from "@raiquora/agent/tool-contract";
import { conditionDelta, conditionOperationId, conditionPayload } from "@raiquora/agent/conversation-condition";
import { reduceConversationIntent, type IntentApplicationReceipt } from "@raiquora/agent/conversation-intent-reducer";
import { publicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
import { compileEffectiveIntent } from "@raiquora/agent/effective-intent";
import type { ConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { createConversationConditionApplication } from "../usecases/agent/conversation-condition-application.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { stateA, conversationId } from "../adapters/state-dynamodb.fixture.js";
import { StateError } from "../contracts/server-state.js";
import type { ConversationConditionRepository } from "../ports/conversation-condition-repository.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

/** Paid opt-in, early contract check before the persistence integration. Real SDK/Bedrock,
 * small business writer with a test repository and deterministic read data. No production
 * state/Provider is accessed. Seven turns, each at most 8 cycles / 2 reads / 60 seconds. */
const enabled = process.env.AGENT_V2_LIVE === "true";
const modelId = process.env.MODEL_ID ?? "amazon.nova-lite-v1:0";
const limits = { maxIterations: 8, maxModelCalls: 8, maxToolCalls: 2, maxExecutionMs: 60000, maxEvidence: 20 };
describe.skipIf(!enabled)("small condition Tools with real Bedrock", () => {
  it("accepts real changes, not questions or hypotheses, without an interpretation report", async () => {
    let overlay: ConversationIntentOverlay = { version: 1, intentRevision: 0, facts: [], tombstones: [], appliedMutationIds: [] };
    const journal = new Map<string, { payload: string; receipt: IntentApplicationReceipt }>();
    const repository: ConversationConditionRepository = { acceptCondition: async (identity, _lease, change) => {
      const key = conditionOperationId(identity.turnId, change.target), payload = conditionPayload(change), saved = journal.get(key);
      if (saved) { if (saved.payload !== payload) throw new StateError("conflict"); return saved.receipt; }
      const reduction = reduceConversationIntent(overlay, conditionDelta(change, identity.turnId, overlay));
      overlay = reduction.overlay; journal.set(key, { payload, receipt: reduction.receipt });
      return reduction.receipt;
    } };
    const scenarios = [
      { message: "おはよう", origin: undefined, destination: undefined, writes: 0 },
      { message: "京都に行きたい。どんなところ？", origin: undefined, destination: "京都", writes: 1 },
      { message: "やっぱり行き先は神戸に変更したい", origin: undefined, destination: "神戸", writes: 2 },
      { message: "大阪から京都に行きたい。今回の条件にして", origin: "大阪", destination: "京都", writes: 4 },
      { message: "金沢に行くとしたらどう？今の条件は変えずに比較したい", origin: "大阪", destination: "京都", writes: 4 },
      { message: "行き先はいったん未定に戻して。出発地はそのまま", origin: "大阪", destination: undefined, writes: 5 },
      { message: "ありがとう", origin: "大阪", destination: undefined, writes: 5 },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const turnId = `71600000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const apply = createConversationConditionApplication(repository, { principal: stateA, conversationId, turnId },
        { attemptId: turnId, userSequence: index + 1 }, scenario.message);
      const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
      const read = vi.fn(async ({ place }: { place: string }) => successfulAgentToolResult({
        sourceTitle: place, sourceExcerpt: "散策の候補となる場所です。接続試験用の資料です。",
        sourceUrl: "https://example.org/places/verified", sourcePrecision: "place-description",
      }));
      tools.register({ name: "lookup_place", effect: "read", description: "候補の場所について固定資料を確認する。", inputSchema: {
        type: "object", properties: { place: { type: "string" } }, required: ["place"], additionalProperties: false },
        parseInput: raw => validAgentToolInput(raw as { place: string }), execute: read });
      evidenceRegistry.register("lookup_place", (output, context) => [{ id: `evidence:${context.executionId}:${context.toolCallId}`, category: "station",
        knowledgeKind: "deterministic_fact", subject: "資料", facts: output as Evidence["facts"],
        references: [{ sourceType: "external-source", sourceRef: "https://example.org/places/verified", retrievedAt: context.retrievedAt, freshness: "current", summary: "接続試験の資料" }],
        observation: { observationId: `obs:${context.executionId}:${context.toolCallId}`, subjectKey: "place:fixture:verified",
          predicate: "place_description", scopeKey: "conversation", retrievedAt: context.retrievedAt,
          applicability: "applicable", retention: "reference_only", state: "current" },
      }]);
      let modelCalls = 0; const selectedTools: string[] = [];
      const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxOutputTokens: 1024 }, {
        createAgent: config => { const agent = new Agent(config); agent.addHook(ModelMessageEvent, event => {
          modelCalls++; selectedTools.push(...event.message.content.flatMap(block => block.type === "toolUseBlock"
            ? [["set_origin", "set_destination", "lookup_place", "strands_structured_output"].includes(block.name) ? block.name : "other"] : []));
        }); return agent; },
      });
      const result = await createStrandsServerRuntime(engine)({ executionId: turnId, userRequest: scenario.message,
        researchMode: { requestedMode: "standard", effectiveMode: "standard" },
        context: { effectiveIntent: compileEffectiveIntent({ overlay }) }, tools, evidenceRegistry,
        toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits,
        researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "condition-live"), { requestedMode: "standard", effectiveMode: "standard" }),
        conditionController: { apply: async change => ({ receipt: publicSemanticReceipt(await apply(change)), effectiveIntent: compileEffectiveIntent({ overlay }) }) },
      });
      const value = (target: "origin" | "destination") => {
        const fact = overlay.facts.find(f => f.target === target); return fact?.value.kind === "place_label" ? fact.value.label : undefined;
      };
      console.log(JSON.stringify({ case: index, modelId, status: result.status, modelCalls, readCalls: read.mock.calls.length, acceptedOperations: journal.size,
        publicationError: result.publicationError, selectedTools }));
      expect.soft(result.status, `case ${index} must reply`).toBe("completed");
      expect.soft(value("origin"), `case ${index} origin`).toBe(scenario.origin);
      expect.soft(value("destination"), `case ${index} destination`).toBe(scenario.destination);
      expect.soft(journal.size, `case ${index} mutation count`).toBe(scenario.writes);
    }
  }, 450000);
});
