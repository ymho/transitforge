import { buildInTripContext } from "@raiquora/trip/in-trip-context";
import { evaluateAreaTripImpact } from "@raiquora/trip/area-trip-impact";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { areaInput, areaHazardEvent, areaNow } from "../../../../modules/trip/domain/area-trip-impact.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { askProgressFixture, modelAnswer } from "./ask-progress-scenarios.fixture";
import { evaluateTravelProgress, type TravelProgressScenario } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTrace } from "../../usecases/agent/agent-trace";
import type { AgentTurnObservation } from "../../usecases/agent/agent-turn-outcome";
import { inTripApplicationEvidence } from "../../usecases/agent/in-trip-application-evidence";
import type { EvidenceCoverage } from "../../usecases/agent/evidence-model";
import type { InTripPresentation } from "../../usecases/agent/in-trip-answer-plan";

export const inTripCaseIds = ["AJ-in-trip-next", "AK-in-trip-rail", "AL-in-trip-rain", "AM-in-trip-location-denied"];
/** Same production runtime and optional live Converse; only storage/provider I/O uses synthetic fixtures. */
export async function runInTripProgressScenario(scenario: TravelProgressScenario, live?: BedrockAgentConverse) {
  const f = inTripFixture(); let trip = f.trip, snapshot = f.snapshot;
  if (scenario.id === "AL-in-trip-rain") {
    const weather = areaInput(), hazard = areaInput(areaHazardEvent()); trip = { ...weather.trip, lifecycleState: "in_trip" };
    snapshot = buildInTripContext(trip, { at: areaNow, timeZone: "UTC" }, { tripConfirmed: true, impacts: [weather, hazard].map((i) => ({
      impact: evaluateAreaTripImpact({ ...i, trip }), observedAt: areaNow, expiresAt: "2026-09-12T09:00:00Z", fresh: true })), notifications: [], reservations: [] })!;
  }
  if (scenario.id === "AM-in-trip-location-denied") snapshot = { ...snapshot, location: { status: "permission-denied" } };
  const answers: Record<string, string> = {
    "AJ-in-trip-next": "この後は11時から庭園の散策を予定しています。予定上の移動と実際の現在地は別です。列車の遅延に関する影響があるので、まず接続の注意点を確認するのがよさそうです。現在地は確認できていません。旅程は変更していません。",
    "AK-in-trip-rail": "保存された鉄道予定では、列車の遅延は6分、乗換余裕の見込みは4分、必要時間は5分です。このままで大丈夫とは断定できません。実際にどの列車に乗っているかは位置情報から推測せず、必要なら接続の選択肢を確認しましょう。旅程は変更していません。",
    "AL-in-trip-rain": "旅程に対応した雨の予報と警報の情報があります。ただし屋外で過ごすかや警報の適用範囲には未確認事項があり、この施設が危険とは断定できません。予定の時間幅を踏まえ、雨を避けて待つなどの選択肢を相談できます。中止や旅程の変更はまだしていません。",
    "AM-in-trip-location-denied": "現在地へのアクセスは許可されていないので、いまどこにいるかや乗車中かは分かりません。位置情報がなくても、保存された旅程と現在時刻、列車の遅延に関する影響をもとに、この後の予定を一緒に確認できます。",
  };
  const before = JSON.stringify({ trip, snapshot }); let calls = 0, trace: AgentTrace | undefined, observation: AgentTurnObservation | undefined;
  const evidence = inTripApplicationEvidence(snapshot);
  const requiredCoverage: Record<string, EvidenceCoverage[]> = {
    "AJ-in-trip-next": ["trip.next-item"], "AK-in-trip-rail": ["rail.connection"],
    "AL-in-trip-rain": ["weather.impact", "hazard.impact"], "AM-in-trip-location-denied": ["location.permission"],
  };
  let sawContext = false;
  const response = await runViewerAgentRuntime(scenario.userRequest, { ...askProgressFixture("C-candidate").base,
    candidateSelection: undefined, getTravelCandidates: () => [], getCurrentTrip: () => trip,
    getCurrentDate: () => new Date(snapshot.now.at), inTripContextReader: { read: async () => snapshot },
    storeAgentTrace: async (v) => { trace = v; }, onTurnObservation: (v) => { observation = v; },
  }, async (...args) => {
    calls++;
    const text = args[0].flatMap((m) => m.content.flatMap((b) => "text" in b ? [b.text] : [])).join("\n");
    sawContext ||= text.includes('"inTrip"') && text.includes('"in-trip-v1"') && text.includes(snapshot.trip.id);
    return live ? live(...args) : modelAnswer(`<decision_summary>${JSON.stringify({ interpretedGoal: "旅行中の質問へ保存済み事実で答える",
      hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["evidence_sufficient"],
      usedEvidenceIds: evidence.filter((e) => e.coverage?.some((c) => requiredCoverage[scenario.id]!.includes(c))).map((e) => e.id),
      inTripAnswerPlan: { evidence: requiredCoverage[scenario.id]!.map((coverage) => ({
        evidenceId: evidence.find((e) => e.coverage?.includes(coverage))!.id,
        presentation: ({ "trip.next-item": "planned-itinerary", "rail.connection": "rail-impact", "weather.impact": "weather-impact",
          "hazard.impact": "hazard-impact", "location.permission": "location-permission" } as Partial<Record<EvidenceCoverage, InTripPresentation>>)[coverage],
      })) },
    })}</decision_summary>${answers[scenario.id]!}`);
  });
  const report = evaluateTravelProgress(scenario.id, [{ observation, trace, delivered: true, modelCalls: calls }], scenario.thresholds, live ? "live" : "scripted");
  const failures: string[] = [], text = typeof response === "string" ? response : response.text;
  const used = trace?.events.flatMap((e) => e.type === "decision_recorded" && e.selectedAction === "answer" ? e.usedEvidenceIds ?? [] : []) ?? [];
  for (const scope of requiredCoverage[scenario.id]!) if (!evidence.some((e) => e.coverage?.includes(scope) && used.includes(e.id))) failures.push(`answer did not use Evidence coverage ${scope}`);
  const rendered = trace?.events.flatMap((e) => e.type === "decision_recorded" ? e.inTripAnswerPlan?.evidence ?? [] : []) ?? [];
  for (const scope of requiredCoverage[scenario.id]!) if (!evidence.some((e) => e.coverage?.includes(scope) && rendered.some((r) => r.evidenceId === e.id))) failures.push(`answer did not render Evidence coverage ${scope}`);
  if (!sawContext) failures.push("in-trip snapshot missing from model context");
  if (!trace?.events.some((e) => e.type === "evidence_collected" && e.sourceTypes.includes("trip-state"))) failures.push("Application Evidence missing from runtime trace");
  if (!text?.trim() || /案内を完了できません|安全な実行上限/.test(text)) failures.push("response failed");
  if (JSON.stringify({ trip, snapshot }) !== before) failures.push("read-only context mutated Trip");
  if (scenario.id === "AJ-in-trip-next" && (!snapshot.itinerary.next.some((i) => i.itemId === "garden") || !/庭園/.test(text))) failures.push("next adopted itinerary not explained");
  if (report.toolCalls !== 0 || calls !== 1) failures.push("snapshot-sufficient question added unnecessary calls");
  if (scenario.id === "AK-in-trip-rail" && (!/遅[延れ]|乗換|接続/.test(text) || /列車番号を教え|問題ありません|大丈夫です/.test(text))) failures.push("rail impact ignored or unsafe assurance");
  if (scenario.id === "AK-in-trip-rail") {
    if (!text.includes("6分") || !text.includes("乗車しているかは確認できていません")) failures.push("delay or actual boarding uncertainty omitted");
    const connection = snapshot.impacts.items.flatMap((i) => i.facts).find((f) => f.type === "connection-buffer");
    if (!connection || ![connection.projectedMinutes, connection.requiredMinutes].every((minutes) => text.includes(`${minutes}分`))) {
      failures.push("saved connection-buffer measurements not explained");
    }
  }
  if (scenario.id === "AL-in-trip-rain" && (!/未確認|不明|断定|確認でき/.test(text) || /施設は危険|中止してください/.test(text))) failures.push("hazard uncertainty lost");
  if (scenario.id === "AM-in-trip-location-denied" && (!/現在地|位置情報/.test(text) || !/許可|分かりません|確認でき|未確認|不明/.test(text))) failures.push("location denied not acknowledged");
  if (snapshot.location.status !== "available" && /(?:現在|今)[、は]*(?:列車(?:の移動中|で移動中)です|乗車中です|屋外で)/.test(text)) failures.push("planned state promoted to actual location or boarding");
  if (/bookingReference|episodeId|dedupeKey|ownerSubject/.test(JSON.stringify({ response, trace }))) failures.push("private data exposed");
  if (report.ttfc !== null || report.ttfi !== null) failures.push("in-trip explanation mislabeled as new itinerary/candidate");
  report.contractFailures.push(...failures); report.failures.push(...failures); report.passed = report.failures.length === 0;
  // Synthetic fixture response only; never model reasoning or production conversation data.
  return { ...report, answerForReview: text.slice(0, 2_000), usedEvidenceIds: [...new Set(used)], renderedEvidence: rendered };
}
