import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { evaluateTripHardConstraints } from "@raiquora/trip/trip-constraint-evaluation";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";
import { requestConstraint } from "../../../../modules/trip/domain/trip-request.fixture";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";
import type { AgentTrace } from "@raiquora/agent/agent-trace";
import type { BedrockAgentMessage, BedrockAgentResponse } from "../http/agent-api/bedrock-agent";
import type { EvidenceClaim } from "@raiquora/agent/evidence-model";
import { runViewerAgentRuntime, type BedrockAgentConverse, type ViewerAgentRuntimeDependencies } from "./viewer-agent-runtime";

/** Authored synthetic facts; not a recording of a provider or a claim about a real destination. */
export const progressPage = { url: "https://example.com/nature", title: "評価用の森の温泉郷",
  text: "森の温泉郷は、森林の散策路と温泉を楽しめる評価用の架空地域です。駅からの交通時間や宿の空室は未確認です。" };
export const progressQuote = "森の温泉郷は、森林の散策路と温泉を楽しめる評価用の架空地域です。";
export const progressSource = { id: "progress-page", kind: "web-page", provider: "synthetic", sourceId: "nature",
  sourceUrl: progressPage.url, retrievedAt: "2026-09-12T07:58:00Z", confidence: "observed" };
export const progressCaseIds = ["A-vague", "B-known-region", "C-candidate", "D-known-request", "E-past", "F-hard-unknown", "G-consecutive"] as const;
export type ProgressCaseId = typeof progressCaseIds[number];

export function modelTool(name: string, input: Record<string, unknown>, id = name) {
  return { toolUse: { toolUseId: id, name, input } };
}
export function modelTools(...content: ReturnType<typeof modelTool>[]): BedrockAgentResponse {
  return { message: { role: "assistant", content }, stopReason: "tool_use" };
}

/** Scripted model selects only claims actually offered in the production wire contract. */
export function modelGroundedAnswer(messages: BedrockAgentMessage[]): BedrockAgentResponse {
  const instruction = messages.flatMap((m) => m.content.flatMap((c) => "text" in c && c.text.includes("利用可能Claim: ") ? [c.text] : [])).at(-1);
  if (!instruction) throw new Error("Expected production grounding contract");
  const claims = (JSON.parse(instruction.split("利用可能Claim: ")[1]!) as EvidenceClaim[]).slice(0, 2);
  return modelAnswer(JSON.stringify({ text: claims.map((c) => c.statement).join("\n\n"), claims }));
}
export function modelAnswer(text: string): BedrockAgentResponse {
  return { message: { role: "assistant", content: [{ text }] }, stopReason: "end_turn" };
}
export const progressQuestion = { question: "今回、利用できる交通手段について希望を教えてください", expectedInput: "free-text" };

export function askProgressFixture(id: ProgressCaseId) {
  const request = { constraints: [
    requestConstraint({ type: "origin", place: { name: "京都", sources: [] } }, { id: "origin" }),
    requestConstraint({ type: "dates", start: { earliest: "2026-09-21", latest: "2026-09-24" } }, { id: "dates", strength: "soft" }),
  ], assumptions: [] };
  let trip = createTrip("11111111-1111-4111-8111-111111111111", "自然を楽しむ旅", "2026-09-12T08:00:00Z", [],
    id === "A-vague" ? { constraints: [], assumptions: [] } : request);
  if (id === "C-candidate") trip = { ...trip, planningState: "candidate_selection", items: [
    { id: "outbound", title: "候補Aの移動", type: "transport", schedule: { type: "unscheduled" }, detail: { status: "unresolved" } },
    { id: "stay", title: "現地での宿泊", type: "stay", schedule: { type: "unscheduled" }, selection: { status: "unselected" } },
  ] };
  if (id === "E-past") trip = { ...trip, request: { constraints: [requestConstraint({ type: "dates",
    start: { earliest: "2025-09-22", latest: "2025-09-22" } }, { id: "dates" })], assumptions: [] }, items: [
    { id: "past-stay", title: "以前の滞在", type: "stay", schedule: { type: "day", date: "2025-09-22", timeZone: "Asia/Tokyo" }, selection: { status: "unselected" } },
  ] };
  if (id === "F-hard-unknown") trip = { ...trip, request: { ...request, constraints: [...request.constraints,
    requestConstraint({ type: "arrive_by", place: { name: "京都駅", sources: [] }, at: { at: "2026-09-24T18:00:00+09:00", timeZone: "Asia/Tokyo" } }, { id: "return-deadline" }),
  ] } };
  const scripts: BedrockAgentResponse[] = [];
  if (id === "C-candidate") scripts.push(modelTools(modelTool("propose_candidate_selection", { candidateId: "candidate-a", itemId: "outbound" })));
  else if (id === "E-past") scripts.push(modelAnswer("2025年9月22日の以前の旅行を振り返ります。新しい旅行の日程には流用せず、保存された以前の滞在案を確認できます。"));
  else {
    if (id === "D-known-request") scripts.push(modelTools(modelTool("ask_follow_up", { question: "出発地を教えてください", expectedInput: "free-text", requestedRequirement: "origin" }, "known-origin")));
    if (id === "G-consecutive") scripts.push(modelTools(modelTool("ask_follow_up", progressQuestion)));
    scripts.push(modelTools(modelTool("search_web", { query: "9月下旬 自然 温泉 のんびり 旅行", limit: 3 })));
    scripts.push(modelTools(modelTool("read_web_pages", { urls: [progressPage.url] })));
    const present = modelTool("present_travel_progress", { summary: "自然を楽しみながらゆっくり過ごすなら、森の温泉郷を比較候補にします。交通や空室は未確認です。",
      findings: [{ sourceUrl: progressPage.url, quote: progressQuote }] });
    const ask = modelTool("ask_follow_up", id === "F-hard-unknown" ? { ...progressQuestion,
      question: "18時の京都駅帰着は未検証です。現地で利用できる交通手段に希望はありますか", requestedRequirement: "mobility",
      reason: "18時までの帰着をまだ検証できていません。", askOnlyException: { reason: "hard_constraint_unknown", missingFact: "帰着経路の成立性", constraintId: "return-deadline" },
    } : id === "A-vague" ? { ...progressQuestion, requestedRequirement: "origin", question: "出発する地域を教えてください" } : progressQuestion, "final-question");
    scripts.push(modelTools(present, ...(id === "G-consecutive" ? [] : [ask])));
  }
  const { candidate, inputs, selectedAt } = railSelectionFixture();
  const candidateValue = createTravelCandidate({ id: candidate.candidateId, journey: candidate.journey });
  const base: ViewerAgentRuntimeDependencies = {
    trains: [], getPositions: () => [], getRouteTime: () => 1670, maximumRouteTime: 1800,
    getCurrentDate: () => new Date(selectedAt), getCurrentTrip: () => trip,
    queryDailyCongestionAnalysis: async () => { throw new Error("No operation fixture"); },
    queryTrainDelayAnalysis: async () => { throw new Error("No delay fixture"); },
    searchWeb: async () => ({ webSearch: { status: "available", freshness: "fresh", evidence: [progressSource], data: { query: "自然", results: [{ title: progressPage.title, url: progressPage.url, description: progressPage.text }] } } }),
    readWebPages: async () => ({ webPages: { status: "available", freshness: "fresh", evidence: [progressSource], data: { pages: [progressPage] } } }),
    ...(id === "G-consecutive" ? { previousAssistantTurn: "ask_only" as const } : {}),
    ...(id === "C-candidate" ? {
      getTravelCandidates: () => [{ id: candidate.candidateId, targetItemId: "outbound", label: "候補A", verified: true }],
      candidateSelection: { taskId: "task-a", port: {
        resolve: async (candidateId: string) => candidateId === candidate.candidateId ? { candidate: candidateValue, tripId: trip.id,
          taskId: "task-a", validUntil: "2026-09-12T09:00:00Z", rail: candidate } : undefined,
        loadTimetables: async () => inputs,
      } },
    } : {}),
  };
  const prompts: Record<ProgressCaseId, string> = {
    "A-vague": "9月下旬に夫婦で3泊くらい、自然があってのんびりできるところ",
    "B-known-region": "京都発で9月21〜24日頃、自然があってのんびりできるところ",
    "C-candidate": "候補Aを選びます。出発時間は任せるので旅程を作って",
    "D-known-request": "その条件で候補を見たい",
    "E-past": "以前の旅を振り返りたい",
    "F-hard-unknown": "18時までに京都へ帰る条件は必須。可能な候補を先に見たい",
    "G-consecutive": "まだ決めていません。いま出せる候補を見たい",
  };
  return { trip, base, scripts, prompt: prompts[id] };
}

export async function runAskProgressCase(id: ProgressCaseId, live?: BedrockAgentConverse) {
  const fixture = askProgressFixture(id);
  const original = structuredClone(fixture.trip);
  let observation: AgentTurnObservation | undefined;
  let trace: AgentTrace | undefined;
  const contexts: string[] = [];
  const toolsByCall: string[][] = [];
  let calls = 0;
  const converse: BedrockAgentConverse = async (messages, tools, modelClass, callId) => {
    contexts.push(firstContext(messages)); toolsByCall.push((tools ?? []).map((t) => t.name));
    const index = calls++;
    return live ? live(messages, tools, modelClass, callId) : fixture.scripts[index] ?? modelAnswer("取得した情報だけでは判断できません。");
  };
  const response = await runViewerAgentRuntime(fixture.prompt, { ...fixture.base,
    onTurnObservation: (value) => { observation = value; }, storeAgentTrace: async (value) => { trace = value; },
  }, converse);
  const failures: string[] = [];
  if (!observation) failures.push("completed turn observation is missing");
  if (id !== "E-past" && !observation?.progress.length) failures.push("visible progress missing (a Tool call alone does not qualify)");
  if (id === "G-consecutive" && observation?.outcome === "ask_only" && !observation.exception) failures.push("consecutive ask-only without exception");
  if (id === "C-candidate" && (typeof response === "string" || !("tripUpdateProposal" in response))) failures.push("candidate did not produce V2 proposal");
  const proposal = typeof response !== "string" && "tripUpdateProposal" in response ? response.tripUpdateProposal : undefined;
  const preview = proposal ? applyTripProposal(fixture.trip, proposal) : fixture.trip;
  if (id === "C-candidate" && (preview.planningState !== "itinerary_draft" ||
      !preview.items.some((item) => item.type === "transport" && item.detail.status === "selected") || preview.items[1]?.schedule.type !== "unscheduled")) {
    failures.push("adoption must produce an actual draft and preserve unknown stay time");
  }
  if (id === "F-hard-unknown" && !evaluateTripHardConstraints(preview).some((c) => c.constraintId === "return-deadline" && c.status === "unknown")) {
    failures.push("unknown hard constraint was lost or declared satisfied");
  }
  if (id === "E-past" && (JSON.stringify(preview.request) !== JSON.stringify(original.request) ||
      !contexts[0]?.includes('"position":"past"') || !contexts[0]?.includes('"earliest":"2025-09-22"'))) {
    failures.push("past request must remain a past request, not silently become new-trip conditions");
  }
  if (id === "D-known-request") {
    const successful = new Set(trace?.events.flatMap((e) => e.type === "tool_completed" && e.outcome === "success" ? [e.toolCallId] : []));
    for (const event of trace?.events ?? []) {
      if (event.type !== "tool_called" || event.toolName !== "ask_follow_up" || !successful.has(event.toolCallId)) continue;
      const input = event.input.value as Record<string, unknown> | undefined;
      if (input && (["origin", "dates"].includes(String(input.requestedRequirement)) || input.expectedInput === "departure-date")) {
        failures.push("accepted follow-up repeated an existing Request condition");
      }
    }
  }
  if (JSON.stringify(fixture.trip) !== JSON.stringify(original)) failures.push("source Trip was mutated");
  return { id, response, observation, trace, calls, contexts, toolsByCall, trip: fixture.trip, failures };
}

function firstContext(messages: BedrockAgentMessage[]): string {
  return messages[0]?.content.flatMap((c) => "text" in c ? [c.text] : []).join("\n") ?? "";
}
