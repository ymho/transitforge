import { describe, expect, it } from "vitest";
import { Agent, ModelMessageEvent } from "@strands-agents/sdk";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";
import { conditionDelta, conditionOperationId, conditionPayload } from "@raiquora/agent/conversation-condition";
import { reduceConversationIntent, type IntentApplicationReceipt } from "@raiquora/agent/conversation-intent-reducer";
import { publicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
import { compileEffectiveIntent } from "@raiquora/agent/effective-intent";
import type { ConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import { createConversationConditionApplication } from "../usecases/agent/conversation-condition-application.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { stateA, conversationId } from "../adapters/state-dynamodb.fixture.js";
import { StateError } from "../contracts/server-state.js";
import type { ConversationConditionRepository } from "../ports/conversation-condition-repository.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

const enabled = process.env.AGENT_V2_LIVE === "true";
const modelId = process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0";
const limits = { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 1, maxExecutionMs: 60_000, maxEvidence: 4 };

describe.skipIf(!enabled)("budget condition Tool with real Bedrock", () => {
  it("persists only grounded actual budget authority and routes budget what-if through scenario", async () => {
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
      { message: "おはよう", budget: undefined, writes: 0, update: false, scenario: false },
      { message: "予算は全部で10万円までにします",
        budget: { kind: "money", amount: 100000, currency: "JPY", basis: "trip" } as const, writes: 1, update: true, scenario: false },
      { message: "やっぱり予算は1人5万円くらいに変更します",
        budget: { kind: "money", amount: 50000, currency: "JPY", basis: "per_person" } as const, writes: 2, update: true, scenario: false },
      { message: "もし500ユーロならどう？今の予算は変えずに比較したい",
        budget: { kind: "money", amount: 50000, currency: "JPY", basis: "per_person" } as const, writes: 2, update: false, scenario: true },
      { message: "予算は500ユーロに変更します",
        budget: { kind: "money", amount: 500, currency: "EUR" } as const, writes: 3, update: true, scenario: false },
      { message: "予算はいったん未定に戻して", budget: undefined, writes: 4, update: true, scenario: false },
      { message: "ありがとう", budget: undefined, writes: 4, update: false, scenario: false },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const turnId = `73200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const apply = createConversationConditionApplication(repository, { principal: stateA, conversationId, turnId },
        { attemptId: turnId, userSequence: index + 1 }, scenario.message);
      const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
      let modelCalls = 0, writerCallbacks = 0; const selectedTools: string[] = [];
      const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxOutputTokens: 1_024 }, {
        createAgent: config => { const agent = new Agent(config); agent.addHook(ModelMessageEvent, event => {
          modelCalls++; selectedTools.push(...event.message.content.flatMap(block => block.type === "toolUseBlock"
            ? [["update_current_budget", "consider_trip_scenario", "strands_structured_output"].includes(block.name) ? block.name : "other"] : []));
        }); return agent; },
      });
      const result = await createStrandsServerRuntime(engine)({ executionId: turnId, userRequest: scenario.message,
        researchMode: { requestedMode: "standard", effectiveMode: "standard" },
        context: { effectiveIntent: compileEffectiveIntent({ overlay }) }, tools, evidenceRegistry,
        toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits,
        researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "budget-live"),
          { requestedMode: "standard", effectiveMode: "standard" }),
        conditionController: { apply: async change => {
          writerCallbacks++;
          try { return { receipt: publicSemanticReceipt(await apply(change)), effectiveIntent: compileEffectiveIntent({ overlay }) }; }
          catch (error) {
            console.log(JSON.stringify({ event: "budget-writer-rejected", case: index,
              code: error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "unknown",
              target: change.target }));
            throw error;
          }
        } },
      });
      const budget = overlay.facts.find(value => value.target === "budget")?.value;
      console.log(JSON.stringify({ case: index, modelId, status: result.status, modelCalls, writerCallbacks,
        acceptedOperations: journal.size, publicationError: result.publicationError, selectedTools }));
      expect.soft(result.status, `case ${index} must reply`).toBe("completed");
      expect.soft(budget, `case ${index} budget`).toEqual(scenario.budget);
      expect.soft(journal.size, `case ${index} mutation count`).toBe(scenario.writes);
      expect.soft(selectedTools.includes("update_current_budget"), `case ${index} writer selection`).toBe(scenario.update);
      expect.soft(selectedTools.includes("consider_trip_scenario"), `case ${index} scenario selection`).toBe(scenario.scenario);
    }
  }, 300_000);
});
