import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
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
const teen: PartyCohort = { ...college, ageDecade: "teens" };
const child: PartyCohort = { count: 1, membership: "baseline", schoolStage: "elementary", scope: whole };
const childUntilDayTwo: PartyCohort = { ...child, scope: days(["day-a", "day-b"]) };
const adult: PartyCohort = { count: 1, membership: "baseline", ageDecade: "thirties", scope: whole };
const joined: PartyCohort = { ...college, membership: "additional", scope: days(["day-b", "day-c"]) };
const segment: PartyCohort = { ...joined, scope: { kind: "segment", tripId: catalog.tripId, tripRevision: catalog.tripRevision, segmentId: "return" } };
interface Case { message: string; cohorts?: PartyCohort[]; writes?: number; update?: boolean; scenario?: boolean; noCatalog?: boolean; clarification?: boolean; observeFirstInterpretation?: boolean }

/** Each fixture owns independent, synthetic Application state. No production writes.
 * The original first-pass probes stay strict. Dialogue mode observes the first
 * interpretation, then REQUIRES the subsequent explicit correction to be right.
 * This is test sequencing, not a runtime retry/repair or an altered user message. */
async function runCases(fixture: string, cases: Case[], initialCohorts?: PartyCohort[], dialogueCompletion = false): Promise<void> {
  let overlay = reduceConversationIntent(emptyConversationIntentOverlay(), conditionDelta({ target: "party_size",
    party: { kind: "count", people: 3 }, quote: "全体で3人" }, "previous-user-turn", emptyConversationIntentOverlay())).overlay;
  if (initialCohorts) {
    overlay = reduceConversationIntent(overlay, conditionDelta({ target: "party_details", cohorts: parsePartyCohorts(initialCohorts),
      quote: "以前に受理された合成条件" }, "synthetic-prior-details", overlay)).overlay;
  }
  const journal = new Map<string, { payload: string; receipt: IntentApplicationReceipt }>();
  const history: Array<{ role: "user" | "assistant"; text: string }> = [];
  const repository: ConversationConditionRepository = { acceptCondition: async (identity, _lease, change) => {
    const key = conditionOperationId(identity.turnId, change.target), payload = conditionPayload(change), saved = journal.get(key);
    if (saved) { if (saved.payload !== payload) throw new StateError("conflict"); return saved.receipt; }
    const reduced = reduceConversationIntent(overlay, conditionDelta(change, identity.turnId, overlay));
    overlay = reduced.overlay; journal.set(key, { payload, receipt: reduced.receipt });
    return reduced.receipt;
  } };
  for (const [index, scenario] of cases.entries()) {
    const turnId = `72900000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const before = structuredClone(overlay), journalBefore = new Set(journal.keys());
    const apply = createConversationConditionApplication(repository, { principal: stateA, conversationId, turnId },
      { attemptId: turnId, userSequence: index + 1 }, scenario.message);
    const scopeCatalog = scenario.noCatalog ? undefined : catalog;
    const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
    let modelCalls = 0, writerCallbacks = 0;
    const selectedTools: string[] = [];
    const engine = new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxOutputTokens: 1_536, maxInvocationOutputTokens: 1_536 }, {
      createAgent: config => { const agent = new Agent(config); agent.addHook(ModelMessageEvent, event => {
        modelCalls++; selectedTools.push(...event.message.content.flatMap(block => block.type === "toolUseBlock"
          ? [["update_current_party", "update_current_party_details", "consider_trip_scenario", "strands_structured_output"].includes(block.name) ? block.name : "other"] : []));
      }); return agent; },
    });
    const result = await createStrandsServerRuntime(engine)({ executionId: turnId, userRequest: scenario.message,
      researchMode: { requestedMode: "standard", effectiveMode: "standard" }, context: { effectiveIntent: compileEffectiveIntent({ overlay }), conversation: { messages: history.slice(-12) } },
      tools, evidenceRegistry, toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits,
      researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "cohort-live"), { requestedMode: "standard", effectiveMode: "standard" }),
      conditionController: { ...(scopeCatalog ? { scopeCatalog } : {}), apply: async change => {
        writerCallbacks++;
        return { receipt: publicSemanticReceipt(await apply(change, scopeCatalog)), effectiveIntent: compileEffectiveIntent({ overlay }) };
      } },
    });
    history.push({ role: "user", text: scenario.message });
    if (result.status === "completed") history.push({ role: "assistant", text: result.response });
    const details = overlay.facts.find(fact => fact.target === "party_details")?.value;
    const expectedDetails = scenario.cohorts ? { kind: "party_cohorts", cohorts: parsePartyCohorts(scenario.cohorts) } : undefined;
    // Bounded operational diagnostics only; no model prose, reasoning or production inputs.
    console.log(JSON.stringify({ fixture, case: index, modelId, status: result.status, modelCalls, writerCallbacks,
      acceptedOperations: journal.size, publicationError: result.publicationError, selectedTools, replyKind: result.publicReply?.kind,
      ...(scenario.observeFirstInterpretation ? { firstInterpretationMatches: isDeepStrictEqual(details, expectedDetails),
        clarifiedWithoutWrite: result.publicReply?.kind === "clarification" && writerCallbacks === 0 && isDeepStrictEqual(overlay, before) } : {}) }));
    expect.soft(overlay.facts.find(fact => fact.target === "party_size")?.value, `${fixture} case ${index} global count`).toEqual({ kind: "quantity", amount: 3, unit: "people" });
    if (dialogueCompletion) {
      expect.soft(overlay.facts.filter(f => f.target !== "party_details"), "unrelated conditions are preserved").toEqual(before.facts.filter(f => f.target !== "party_details"));
      const accepted = [...journal.keys()].filter(key => !journalBefore.has(key));
      expect.soft(accepted.every(key => key === conditionOperationId(turnId, "party_details")), "only the current cohort business slot can commit").toBe(true);
      expect.soft(accepted.length, "at most one accepted decision per turn").toBeLessThanOrEqual(1);
      expect.soft(overlay.intentRevision, "one revision per accepted decision").toBe(before.intentRevision + accepted.length);
      if (scenario.observeFirstInterpretation) {
        // Quality failures are recorded above and remain failures in the separate
        // first-pass probes. No hypothetical turn may use this observation lane.
        expect(scenario.scenario).not.toBe(true);
        expect(scenario.noCatalog).not.toBe(true);
        // A misinterpreted first turn stays a quality failure in the strict probe.
        // Final-reply kind alone does not determine which independent slot may
        // commit. The production-history fixture checks the unresolved slot.
        continue;
      }
    }
    expect.soft(result.status, `${fixture} case ${index} reply`).toBe("completed");
    expect.soft(details, `${fixture} case ${index} final cohorts`).toEqual(expectedDetails);
    expect.soft(journal.size, `${fixture} case ${index} accepted operations`).toBe(dialogueCompletion ? journalBefore.size + (scenario.update ? 1 : 0) : scenario.writes);
    expect.soft(overlay.intentRevision, `${fixture} case ${index} revisions`).toBe(before.intentRevision + (scenario.update ? 1 : 0));
    expect.soft(selectedTools.includes("consider_trip_scenario"), `${fixture} case ${index} scenario`).toBe(!!scenario.scenario);
    if (scenario.scenario || !scenario.update && !scenario.noCatalog) {
      expect.soft(writerCallbacks, `${fixture} case ${index} no writer callbacks`).toBe(0);
      expect.soft(overlay, `${fixture} case ${index} unchanged state`).toEqual(before);
    }
    if (scenario.update) {
      expect.soft([...journal.keys()].filter(key => !journalBefore.has(key)), `${fixture} case ${index} one accepted decision`).toEqual([conditionOperationId(turnId, "party_details")]);
      expect.soft(result.publicReply?.kind, `${fixture} case ${index} unnecessary questionnaire`).toBe("conversation");
    }
    if (scenario.noCatalog || scenario.clarification) expect.soft(result.publicReply).toMatchObject({ kind: "clarification", question: "participation_scope" });
  }
}

describe.skipIf(!enabled)("anonymous party details with real Nova 2 Lite", () => {
  it("separates school/decade and participation, keeps what-if nonpersistent, and does not ask for unnecessary exact ages", async () => {
    // Original ten messages and their saved-state expectations remain unchanged.
    await runCases("conditions", [
      { message: "こんにちは", writes: 0 },
      { message: "今回、全行程の同行者のうち1人は20代の大学生です。正確な年齢はまだ分かりません。", cohorts: [college], writes: 1, update: true },
      { message: "さっきの同行者の属性条件はいったんすべて取り消します。全行程の同行者のうち1人は小学生です。年齢はまだ分かりません。", cohorts: [child], writes: 2, update: true },
      { message: "この小学生は2日目まで参加して、その後は離脱します。全行程の人数条件は変えません。", cohorts: [childUntilDayTwo], writes: 3, update: true },
      { message: "詳細条件を変更します。全行程に参加する30代1人と、2日目から最後まで追加参加する20代の大学生1人です。前の小学生の条件は取り消します。", cohorts: [adult, joined], writes: 4, update: true },
      { message: "もし追加参加の大学生が10代ならどう？今の条件は変えずに比較して。", cohorts: [adult, joined], writes: 4, scenario: true },
      { message: "追加参加の大学生は帰路の区間だけ参加することに変更します。30代1人は全行程のままです。", cohorts: [adult, segment], writes: 5, update: true },
      { message: "同行者の詳細条件はいったん未定に戻して。合計3人という条件はそのままです。", writes: 6, update: true },
      { message: "ありがとう", writes: 6 },
      { message: "大学生1人が2日目から追加参加することにします。", writes: 6, noCatalog: true },
    ]);
  }, 660_000);
  it("recovers from a previously accepted duplicate when the user corrects it", async () => {
    // Deliberately seed the previously observed mistake; this is not a successful model prediction.
    await runCases("recovery", [
      { message: "違います。小学生は1人だけで、2日目まで参加して離脱します。全行程に参加する小学生という重複は取り消してください。30代の人は全行程参加のまま、合計3人という条件もそのままです。", cohorts: [adult, childUntilDayTwo], writes: 1, update: true },
    ], [child, childUntilDayTwo, adult]);
  }, 90_000);
  it("clarifies an ambiguous participant without writing and accepts the answer and a later correction", async () => {
    const teenUntilDayTwo = { ...teen, scope: days(["day-a", "day-b"]) };
    const collegeUntilDayTwo = { ...college, scope: days(["day-a", "day-b"]) };
    await runCases("clarification", [
      { message: "今回の大学生のうち1人が2日目まで参加して離脱しますが、10代と20代のどちらかはまだ決まっていません。", cohorts: [college, teen], writes: 0, clarification: true },
      { message: "2日目で帰るのは10代の大学生です。20代の大学生は全行程に参加します。", cohorts: [college, teenUntilDayTwo], writes: 1, update: true },
      { message: "逆でした。2日目まで参加するのは20代の大学生です。10代の大学生は全行程に参加します。", cohorts: [teen, collegeUntilDayTwo], writes: 2, update: true },
    ], [college, teen]);
  }, 210_000);
  it("dialogue completion reaches corrected conditions and preserves what-if and unresolved-scope boundaries", async () => {
    const teenUntilDayTwo = { ...teen, scope: days(["day-a", "day-b"]) };
    const collegeUntilDayTwo = { ...college, scope: days(["day-a", "day-b"]) };
    await runCases("dialogue-completion", [
      { message: "今回の大学生のうち1人が2日目まで参加して離脱しますが、10代と20代のどちらかはまだ決まっていません。", cohorts: [college, teen], observeFirstInterpretation: true },
      { message: "2日目で帰るのは10代の大学生です。20代の大学生は全行程に参加します。", cohorts: [college, teenUntilDayTwo], update: true },
      { message: "逆でした。2日目まで参加するのは20代の大学生です。10代の大学生は全行程に参加します。", cohorts: [teen, collegeUntilDayTwo], update: true },
      { message: "もし20代の大学生も全行程に参加できるならどうですか。今の条件は変えずに考えてください。", cohorts: [teen, collegeUntilDayTwo], scenario: true },
      { message: "同行者の詳細条件はいったん未定に戻して。合計3人という条件はそのままです。", update: true },
      { message: "大学生1人が2日目から追加参加することにします。", noCatalog: true },
    ], [college, teen], true);
  }, 390_000);
  it("dialogue completion recovers from a misunderstood combined withdrawal and replacement", async () => {
    await runCases("compound-correction", [
      { message: "さっきの同行者の属性条件はいったんすべて取り消します。全行程の同行者のうち1人は小学生です。年齢はまだ分かりません。", cohorts: [child], observeFirstInterpretation: true },
      { message: "訂正します。同行者の詳細条件として残すのは、全行程に参加する小学生1人だけです。正確な年齢は未確認です。大学生や20代という前の属性は残さず、合計3人という人数条件は変えないでください。", cohorts: [child], update: true },
    ], [college], true);
  }, 150_000);
});
