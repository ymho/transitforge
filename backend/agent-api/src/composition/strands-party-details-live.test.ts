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
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import { parsePartyCohorts, type PartyCohort, type PartyScopeCatalog } from "@raiquora/trip/party-cohorts";
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
const catalog: PartyScopeCatalog = { tripId: "known-trip", tripRevision: 2,
  days: ["day-a", "day-b", "day-c"].map((id, index) => ({ id, label: `${index + 1}日目` })),
  segments: [{ id: "outbound", label: "往路" }, { id: "return", label: "帰路" }] };
const whole = { kind: "whole_trip" as const };
const days = (dayIds: string[]) => ({ kind: "logical_days" as const, tripId: catalog.tripId, tripRevision: catalog.tripRevision, dayIds });
const college: PartyCohort = { count: 1, membership: "baseline", schoolStage: "university", ageDecade: "twenties", scope: whole };
const child: PartyCohort = { count: 1, membership: "baseline", schoolStage: "elementary", scope: whole };
const adult: PartyCohort = { count: 1, membership: "baseline", ageDecade: "thirties", scope: whole };
const joined: PartyCohort = { ...college, membership: "additional", scope: days(["day-b", "day-c"]) };
const segment: PartyCohort = { ...joined, scope: { kind: "segment", tripId: catalog.tripId, tripRevision: catalog.tripRevision, segmentId: "return" } };
interface Case { message: string; cohorts?: PartyCohort[]; writes: number; update?: boolean; scenario?: boolean; noCatalog?: boolean }

describe.skipIf(!enabled)("anonymous party details with real Nova 2 Lite", () => {
  it("separates school/decade and participation, keeps what-if nonpersistent, and does not ask for unnecessary exact ages", async () => {
    // Known prior user condition, not a model inference from Profile or the new cohorts.
    let overlay = reduceConversationIntent(emptyConversationIntentOverlay(), conditionDelta({ target: "party_size",
      party: { kind: "count", people: 3 }, quote: "全体で3人" }, "previous-user-turn", emptyConversationIntentOverlay())).overlay;
    const journal = new Map<string, { payload: string; receipt: IntentApplicationReceipt }>();
    const repository: ConversationConditionRepository = { acceptCondition: async (identity, _lease, change) => {
      const key = conditionOperationId(identity.turnId, change.target), payload = conditionPayload(change), saved = journal.get(key);
      if (saved) { if (saved.payload !== payload) throw new StateError("conflict"); return saved.receipt; }
      const reduced = reduceConversationIntent(overlay, conditionDelta(change, identity.turnId, overlay));
      overlay = reduced.overlay; journal.set(key, { payload, receipt: reduced.receipt });
      return reduced.receipt;
    } };
    const cases: Case[] = [
      { message: "こんにちは", writes: 0 },
      { message: "今回、全行程の同行者のうち1人は20代の大学生です。正確な年齢はまだ分かりません。", cohorts: [college], writes: 1, update: true },
      { message: "さっきの同行者の属性条件はいったんすべて取り消します。全行程の同行者のうち1人は小学生です。年齢はまだ分かりません。", cohorts: [child], writes: 2, update: true },
      { message: "この小学生は2日目まで参加して、その後は離脱します。全行程の人数条件は変えません。", cohorts: [{ ...child, scope: days(["day-a", "day-b"]) }], writes: 3, update: true },
      { message: "詳細条件を変更します。全行程に参加する30代1人と、2日目から最後まで追加参加する20代の大学生1人です。前の小学生の条件は取り消します。", cohorts: [adult, joined], writes: 4, update: true },
      { message: "もし追加参加の大学生が10代ならどう？今の条件は変えずに比較して。", cohorts: [adult, joined], writes: 4, scenario: true },
      { message: "追加参加の大学生は帰路の区間だけ参加することに変更します。30代1人は全行程のままです。", cohorts: [adult, segment], writes: 5, update: true },
      { message: "同行者の詳細条件はいったん未定に戻して。合計3人という条件はそのままです。", writes: 6, update: true },
      { message: "ありがとう", writes: 6 },
      { message: "大学生1人が2日目から追加参加することにします。", writes: 6, noCatalog: true },
    ];
    for (const [index, scenario] of cases.entries()) {
      const turnId = `72900000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const apply = createConversationConditionApplication(repository, { principal: stateA, conversationId, turnId },
        { attemptId: turnId, userSequence: index + 1 }, scenario.message);
      const scopeCatalog = scenario.noCatalog ? undefined : catalog;
      const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
      let modelCalls = 0, writerCallbacks = 0;
      const selectedTools: string[] = [];
      const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxOutputTokens: 1_536 }, {
        createAgent: config => { const agent = new Agent(config); agent.addHook(ModelMessageEvent, event => {
          modelCalls++; selectedTools.push(...event.message.content.flatMap(block => block.type === "toolUseBlock"
            ? [["update_current_party", "update_current_party_details", "consider_trip_scenario", "strands_structured_output"].includes(block.name) ? block.name : "other"] : []));
        }); return agent; },
      });
      const result = await createStrandsServerRuntime(engine)({ executionId: turnId, userRequest: scenario.message,
        researchMode: { requestedMode: "standard", effectiveMode: "standard" }, context: { effectiveIntent: compileEffectiveIntent({ overlay }) },
        tools, evidenceRegistry, toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits,
        researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "cohort-live"), { requestedMode: "standard", effectiveMode: "standard" }),
        conditionController: { ...(scopeCatalog ? { scopeCatalog } : {}), apply: async change => {
          writerCallbacks++;
          return { receipt: publicSemanticReceipt(await apply(change, scopeCatalog)), effectiveIntent: compileEffectiveIntent({ overlay }) };
        } },
      });
      const details = overlay.facts.find(fact => fact.target === "party_details")?.value;
      console.log(JSON.stringify({ case: index, modelId, status: result.status, modelCalls, writerCallbacks,
        acceptedOperations: journal.size, publicationError: result.publicationError, selectedTools, replyKind: result.publicReply?.kind }));
      expect.soft(result.status, `case ${index} reply`).toBe("completed");
      expect.soft(details, `case ${index} final cohorts`).toEqual(scenario.cohorts ? { kind: "party_cohorts", cohorts: parsePartyCohorts(scenario.cohorts) } : undefined);
      expect.soft(overlay.facts.find(fact => fact.target === "party_size")?.value, `case ${index} global count`).toEqual({ kind: "quantity", amount: 3, unit: "people" });
      expect.soft(journal.size, `case ${index} accepted operations`).toBe(scenario.writes);
      expect.soft(selectedTools.includes("update_current_party"), `case ${index} must not flatten scope into count`).toBe(false);
      if (!scenario.noCatalog) expect.soft(selectedTools.includes("update_current_party_details"), `case ${index} details writer`).toBe(!!scenario.update);
      expect.soft(selectedTools.includes("consider_trip_scenario"), `case ${index} scenario`).toBe(!!scenario.scenario);
      if (scenario.scenario || !scenario.update && !scenario.noCatalog) expect.soft(writerCallbacks, `case ${index} no writer callbacks`).toBe(0);
      if (scenario.update) expect.soft(result.publicReply?.kind, `case ${index} unnecessary questionnaire`).toBe("conversation");
      if (scenario.noCatalog) expect.soft(result.publicReply).toMatchObject({ kind: "clarification", question: "participation_scope" });
    }
  }, 660_000);
});
