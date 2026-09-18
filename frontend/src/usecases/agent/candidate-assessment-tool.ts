import { assessTripCandidate } from "../trip-plan/assess-trip-candidate";
import type { TripProgressDependencies } from "./trip-progress-tools";
import { candidateAssessmentContext } from "./candidate-assessment-context";
import type { AgentToolRegistry } from "./tool-registry";
import { validateAgentToolInput } from "./agent-tool-input-validator";
import { failedAgentToolResult, successfulAgentToolResult, type AgentToolDescriptor } from "./tool-contract";
import type { Evidence } from "./evidence-model";
import { validateTravelCandidateAssessment } from "@raiquora/trip/validate-candidate-assessment";
import type { TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";

export const candidateAssessmentDescriptor: AgentToolDescriptor = {
  name: "assess_travel_candidate",
  description: "候補IDに結び付いた取得済み事実から比較根拠を読む。currentTripへ採用せず、検索や予報生成も行わない。地域identity、hard/soft、計画上の移動、天気・警報・価格観測と鮮度を返す。unknown/unavailableは良好ではない。追加調査が必要かはモデルが判断する。候補提示や質問の前提条件ではなく、partialでも候補を捨てない。",
  inputSchema: { type: "object", properties: { candidateId: { type: "string", minLength: 1, maxLength: 160 },
    itemId: { type: "string", minLength: 1, maxLength: 160 } }, required: ["candidateId"], additionalProperties: false },
  decisionSupport: { capability: "取得済みEvidenceに基づく候補比較。主観的な魅力scoreではない",
    suitableCases: ["候補の条件適合・不足根拠を比較する", "取得済み情報のpartialな評価を更新する", "希望候補が範囲外/未確認で、Contextにある別候補の移動根拠を比較して具体的な代案を説明する"],
    unsuitableCases: ["新しい場所の探索", "天気や警報の取得", "旅程の採用・保存"],
    returnedEvidence: "候補ID別のderived_value、取得済みのExternalSourceEvidenceへの参照",
    freshness: "assessedAtは評価時刻。観測/取得/有効期限はsourceごとに別。古い値を現在値にしない",
    limitations: ["serviceCoverageは現行の収録カタログ・日付別時刻表・駅からのアクセスに基づく。supported以外を移動確認済みとしない。範囲外でも相談は継続でき、代案・追加調査はモデルが判断する",
      "候補IDが既知なら、利用者へ検索許可や候補の駅名を聞き直さず取得済み事実を読める。候補の評価・説明は採用操作ではない", "未結合/未取得の結果はunknown", "異通貨は暗黙換算しない", "全Trip成立性・予約は証明しない"],
    responsibilityBoundary: "Bedrockは追加調査・比較推薦を判断する。Domainは取得済み事実の検証と三値評価のみ" },
};

export function registerCandidateAssessmentTool(registry: AgentToolRegistry, dependencies: TripProgressDependencies, now: () => Date): void {
  if (!dependencies.getCurrentTrip?.() || !dependencies.candidateSelection) return;
  registry.register<Record<string, unknown>, unknown>({ ...candidateAssessmentDescriptor,
    parseInput: (value) => validateAgentToolInput(candidateAssessmentDescriptor.inputSchema, value),
    async execute(input) {
      try {
        const result = await assessTripCandidate(dependencies.getCurrentTrip!()!, { candidateId: input.candidateId as string,
          taskId: dependencies.candidateSelection!.taskId, ...(input.itemId ? { itemId: input.itemId as string } : {}) },
        dependencies.candidateSelection!.port, now().toISOString());
        return successfulAgentToolResult({ ...candidateAssessmentContext(result), assessmentEvidence: result.assessment.sources });
      } catch {
        return failedAgentToolResult({ code: "precondition_failed", message: "このtaskの候補ID・対象予定・期限を確認できません。", retryable: false });
      }
    },
  });
}

/** Same Evidence/Claim pipeline as other tools; no model-declared statuses accepted. */
export function candidateAssessmentEvidence(output: unknown): Evidence[] {
  if (!output || typeof output !== "object") return [];
  const value = output as { candidate?: { id: string }; assessment?: Omit<TravelCandidateAssessment, "sources"> & { sourceRefs?: unknown }; assessmentEvidence?: TravelCandidateAssessment["sources"] };
  if (!value.assessment || !value.candidate || !value.assessmentEvidence) return [];
  const { sourceRefs: _, ...rest } = value.assessment;
  const assessment = { ...rest, sources: value.assessmentEvidence } as TravelCandidateAssessment;
  try { validateTravelCandidateAssessment(assessment); if (assessment.candidateId !== value.candidate.id) return []; } catch { return []; }
  if (!assessment.sources.length) return [];
  return [{ id: `candidate-assessment:${encodeURIComponent(assessment.candidateId)}:${assessment.assessedAt}`,
    category: "external", knowledgeKind: "derived_value", subject: assessment.candidateId,
    facts: { candidateId: assessment.candidateId, constraintStatus: assessment.constraintStatus,
      weather: assessment.weather.status, hazard: assessment.hazard.status, relevance: assessment.relevance.status,
      ...(assessment.serviceCoverage ? { serviceCoverage: assessment.serviceCoverage.status, coverageReason: assessment.serviceCoverage.reason } : {}),
      partial: assessment.partial, hardUnknown: assessment.hardConstraints.filter((c) => c.status === "unknown").map((c) => c.constraintId),
      hardViolations: assessment.hardConstraints.filter((c) => c.status === "violated").map((c) => c.constraintId),
      ...(assessment.mobility.travelMinutes !== undefined ? { plannedTravelMinutes: assessment.mobility.travelMinutes } : {}),
      ...(assessment.mobility.transfers !== undefined ? { plannedTransfers: assessment.mobility.transfers } : {}),
      priceComparability: assessment.price.comparability },
    references: assessment.sources.map((source) => {
      const freshness = assessment.freshness.find((f) => f.evidenceId === source.id)?.status;
      return { sourceType: "external-source", sourceRef: source.sourceUrl ?? source.sourceId ?? source.id,
        retrievedAt: source.retrievedAt, freshness: source.kind === "timetable" ? "scheduled" : freshness === "fresh" ? "current" : freshness === "stale" ? "historical" : "unknown",
        summary: `${source.kind}: ${source.provider} (${source.id})` };
    }) }];
}
