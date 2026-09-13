import { formatMoney } from "@raiquora/trip/money";
import type { TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";
import { validateTravelCandidateAssessment } from "@raiquora/trip/validate-candidate-assessment";

/** Pure labels only. Full cards/DOM and candidate adoption remain #390. */
export function candidateAssessmentView(a: TravelCandidateAssessment): { label: string; tone: "neutral" | "warning" }[] {
  validateTravelCandidateAssessment(a);
  const mobility = `移動: ${a.mobility.travelMinutes === undefined ? "所要時間未確認" : `約${Math.ceil(a.mobility.travelMinutes)}分`} / ${
    a.mobility.transfers === undefined ? "乗換未確認" : `乗換${a.mobility.transfers}回`}`;
  const weather = { favorable: "比較上は良好（予報）", mixed: "変わりやすい条件（予報）", poor: "雨などに注意（予報）", unknown: "未確認", unavailable: "取得できません" }[a.weather.status];
  const unknown = a.hardConstraints.filter((c) => c.status === "unknown").length, violated = a.hardConstraints.filter((c) => c.status === "violated").length;
  return [{ label: mobility, tone: a.mobility.status === "known" ? "neutral" : "warning" },
    { label: `天気: ${weather}`, tone: a.weather.status === "favorable" ? "neutral" : "warning" },
    { label: `注意: ${a.hazard.status === "present" ? "警報・注意情報あり" : "防災情報の網羅性は未確認"}`, tone: "warning" },
    { label: `条件: ${violated}件不一致 / ${unknown}件未確認${!a.hardConstraints.length ? "（対象条件なし・全旅程の成立保証ではありません）" : ""}`, tone: violated || unknown ? "warning" : "neutral" },
    { label: a.price.observations.length ? "価格観測: " + a.price.observations.map((p) => `${formatMoney(p.price)}（観測: ${p.observedAt}）`).join(" / ") +
      (a.price.coverage === "partial" ? "・一部費用のみ" : "") + (a.price.comparability === "mixed-currency" ? "・異通貨のため総額比較不可" : "") : "価格: 未確認（0円ではありません）",
      tone: a.price.status === "known" && a.price.comparability === "same-currency" ? "neutral" : "warning" }];
}
