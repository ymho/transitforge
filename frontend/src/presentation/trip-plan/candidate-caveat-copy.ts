import type { CandidateReasonCode, TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";

const categories = { constraints: "条件", places: "場所", mobility: "移動", weather: "天気", hazard: "防災", price: "料金", party: "人数" };
const reasons: Record<CandidateReasonCode, string> = {
  "verified-match": "取得した根拠と一致", "verified-mismatch": "取得した根拠と不一致", "missing-facts": "判断に必要な情報が未確認",
  "unconfirmed-assumption": "未確認の仮定を含む", "unsupported-requirement": "この条件はまだ判定できません", "partial-coverage": "情報は一部のみ",
  "identity-unresolved": "場所を特定できません", "identity-mismatch": "対象の場所が異なります", "forecast-range-out": "予報の対象期間外",
  "api-unavailable": "情報を取得できません", "stale-facts": "情報が古い可能性があります", "freshness-unknown": "情報の鮮度は未確認",
  "invalid-facts": "根拠を検証できません", "hazard-present": "警報・注意情報あり", "hazard-coverage-unknown": "防災情報の網羅性は未確認",
  "mixed-currency": "異なる通貨のため総額比較できません", "unpriced-items": "料金不明の予定を含みます", "budget-basis-unknown": "予算の対象範囲が未確認",
  "subjective-preference": "好みとの相性は相談して決めます", "weather-poor": "雨などに注意が必要な予報", "weather-mixed": "変わりやすい条件の予報",
};
export function candidateCaveatCopy(caveat: TravelCandidateAssessment["caveats"][number]): string {
  return `${categories[caveat.category]}: ${reasons[caveat.code]}`;
}
