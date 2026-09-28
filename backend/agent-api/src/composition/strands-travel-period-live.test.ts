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
const calendarDate = "2026-09-27";

describe.skipIf(!enabled)("travel-period condition Tool with real Bedrock", () => {
  it.each([
    { name: "isolated-small-budget", maxTokens: 1024, novaReasoningEffort: undefined },
    { name: "production-reasoning-budget", maxTokens: 4096, novaReasoningEffort: "low" as const },
  ])("persists actual periods and keeps what-if non-persistent: $name", async configuration => {
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
      { message: "おはよう", start: undefined, end: undefined, duration: undefined, writes: 0, update: false, scenario: false },
      { message: "明日から2日間で行きます", start: "2026-09-28", end: undefined,
        duration: { kind: "quantity", amount: 2, unit: "days" } as const, writes: 1, update: true, scenario: false },
      { message: "やっぱり10月3日から5日までに変更します", start: "2026-10-03", end: "2026-10-05",
        duration: undefined, writes: 2, update: true, scenario: false },
      { message: "もし1週間ならどう？今の日程は変えずに比較したい", start: "2026-10-03", end: "2026-10-05",
        duration: undefined, writes: 2, update: false, scenario: true },
      { message: "日程はいったん未定に戻して", start: undefined, end: undefined, duration: undefined, writes: 3, update: true, scenario: false },
      { message: "ありがとう", start: undefined, end: undefined, duration: undefined, writes: 3, update: false, scenario: false },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const turnId = `73000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const apply = createConversationConditionApplication(repository, { principal: stateA, conversationId, turnId },
        { attemptId: turnId, userSequence: index + 1 }, scenario.message, calendarDate);
      const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
      let modelCalls = 0; const selectedTools: string[] = [];
      const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxOutputTokens: configuration.maxTokens, maxInvocationOutputTokens: configuration.maxTokens, novaReasoningEffort: configuration.novaReasoningEffort }, {
        createAgent: config => { const agent = new Agent(config); agent.addHook(ModelMessageEvent, event => {
          modelCalls++; selectedTools.push(...event.message.content.flatMap(block => block.type === "toolUseBlock"
            ? [["update_current_travel_period", "consider_trip_scenario", "strands_structured_output"].includes(block.name) ? block.name : "other"] : []));
        }); return agent; },
      });
      const result = await createStrandsServerRuntime(engine)({ executionId: turnId, userRequest: scenario.message,
        researchMode: { requestedMode: "standard", effectiveMode: "standard" },
        context: { featureContext: { calendarDate }, effectiveIntent: compileEffectiveIntent({ overlay }) }, tools, evidenceRegistry,
        toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits,
        researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "period-live"), { requestedMode: "standard", effectiveMode: "standard" }),
        conditionController: { apply: async change => {
          try { return { receipt: publicSemanticReceipt(await apply(change)), effectiveIntent: compileEffectiveIntent({ overlay }) }; }
          catch (error) {
            console.log(JSON.stringify({ event: "period-condition-rejected", case: index,
              code: error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "unknown",
              target: change.target,
              periodShape: change.target === "travel_period" && change.period ? {
                startKind: change.period.start?.kind, endKind: change.period.end?.kind,
                hasDuration: change.period.duration !== undefined,
              } : undefined }));
            throw error;
          }
        } },
      });
      const date = (target: "start_date" | "end_date") => {
        const fact = overlay.facts.find(value => value.target === target);
        return fact?.value.kind === "local_date" ? fact.value.date : undefined;
      };
      const duration = overlay.facts.find(value => value.target === "duration")?.value;
      console.log(JSON.stringify({ configuration: configuration.name, case: index, modelId, status: result.status, modelCalls, acceptedOperations: journal.size,
        publicationError: result.publicationError, selectedTools }));
      expect.soft(result.status, `case ${index} must reply`).toBe("completed");
      expect.soft(date("start_date"), `case ${index} start`).toBe(scenario.start);
      expect.soft(date("end_date"), `case ${index} end`).toBe(scenario.end);
      expect.soft(duration, `case ${index} duration`).toEqual(scenario.duration);
      expect.soft(journal.size, `case ${index} mutation count`).toBe(scenario.writes);
      expect.soft(selectedTools.includes("update_current_travel_period"), `case ${index} writer selection`).toBe(scenario.update);
      expect.soft(selectedTools.includes("consider_trip_scenario"), `case ${index} scenario selection`).toBe(scenario.scenario);
    }
  }, 300_000);
});
