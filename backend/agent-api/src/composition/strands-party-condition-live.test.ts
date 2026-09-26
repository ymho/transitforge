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

/** Paid opt-in: party-only Agent v2 behavior. It deliberately does not reuse V1
 * interpretation fixtures or the destination live lane as an oracle. */
const enabled = process.env.AGENT_V2_LIVE === "true";
const modelId = process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0";
const limits = { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 1, maxExecutionMs: 60_000, maxEvidence: 4 };

describe.skipIf(!enabled)("party condition Tool with real Bedrock", () => {
  it("persists actual party changes but never uses the durable writer for a what-if comparison", async () => {
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
      { message: "おはよう", party: undefined, writes: 0, update: false },
      { message: "今回は2人で行きます。大人か子どもかはまだ決めていません",
        party: { kind: "quantity", amount: 2, unit: "people" } as const, writes: 1, update: true },
      { message: "やっぱり大人2人と子ども1人で行きます。子どもの年齢はまだ未定です",
        party: { kind: "party", adults: 2, children: [{}] } as const, writes: 2, update: true },
      { message: "もし4人ならどうなる？今の人数は変えずに比較したい",
        party: { kind: "party", adults: 2, children: [{}] } as const, writes: 2, update: false },
      { message: "人数はいったん未定に戻して", party: undefined, writes: 3, update: true },
      { message: "ありがとう", party: undefined, writes: 3, update: false },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const turnId = `72700000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const apply = createConversationConditionApplication(repository, { principal: stateA, conversationId, turnId },
        { attemptId: turnId, userSequence: index + 1 }, scenario.message);
      const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
      let modelCalls = 0; const selectedTools: string[] = [];
      const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxOutputTokens: 1_024 }, {
        createAgent: config => { const agent = new Agent(config); agent.addHook(ModelMessageEvent, event => {
          modelCalls++; selectedTools.push(...event.message.content.flatMap(block => block.type === "toolUseBlock"
            ? [["update_current_party", "strands_structured_output"].includes(block.name) ? block.name : "other"] : []));
        }); return agent; },
      });
      const result = await createStrandsServerRuntime(engine)({ executionId: turnId, userRequest: scenario.message,
        researchMode: { requestedMode: "standard", effectiveMode: "standard" },
        context: { effectiveIntent: compileEffectiveIntent({ overlay }) }, tools, evidenceRegistry,
        toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits,
        researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "party-live"), { requestedMode: "standard", effectiveMode: "standard" }),
        conditionController: { apply: async change => ({ receipt: publicSemanticReceipt(await apply(change)), effectiveIntent: compileEffectiveIntent({ overlay }) }) },
      });
      const party = overlay.facts.find(fact => fact.target === "party_size")?.value;
      console.log(JSON.stringify({ case: index, modelId, status: result.status, modelCalls, acceptedOperations: journal.size,
        publicationError: result.publicationError, selectedTools }));
      expect.soft(result.status, `case ${index} must reply`).toBe("completed");
      expect.soft(party, `case ${index} party`).toEqual(scenario.party);
      expect.soft(journal.size, `case ${index} mutation count`).toBe(scenario.writes);
      expect.soft(selectedTools.includes("update_current_party"), `case ${index} writer selection`).toBe(scenario.update);
    }
  }, 300_000);
});
