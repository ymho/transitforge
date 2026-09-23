import type { Evidence, EvidenceCoverage, EvidenceSourceType } from "./evidence-model";
import type { AgentGeneratedResponse } from "./agent-response-generator";
import type { InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import { impactFactSummary } from "./in-trip-application-evidence";

export const inTripPresentations = ["planned-itinerary", "rail-impact", "environment-impact",
  "reservation", "location-permission", "uncertainty", "external-result"] as const;
export type InTripPresentation = typeof inTripPresentations[number];
export interface InTripAnswerPlan {
  evidence: Array<{ evidenceId: string; presentation: InTripPresentation }>;
}

/** Bounded wire contract for newly collected Tool Evidence. Uses the same support check as rendering. */
export function inTripToolPresentationReferences(evidence: readonly Evidence[]): string {
  return JSON.stringify(evidence.flatMap((e) => {
    const presentations = inTripPresentations.filter((p) => supportsInTripPresentation(e, p));
    return presentations.length ? [{ evidenceId: e.id, presentations,
      ...(presentations.includes("external-result") ? { resultKind: e.facts.resultKind, status: e.facts.status, freshness: e.facts.freshness } : {}) }] : [];
  }).slice(0, 6));
}

/** Only references, never model-authored facts. Strict even when invoked without the JSON parser. */
export function validInTripAnswerPlan(value: unknown): value is InTripAnswerPlan {
  if (!record(value) || Object.keys(value).some((k) => k !== "evidence") || !Array.isArray(value.evidence) ||
      value.evidence.length < 1 || value.evidence.length > 6) return false;
  const identities = new Set<string>();
  return value.evidence.every((e) => {
    if (!record(e) || Object.keys(e).some((k) => !["evidenceId", "presentation"].includes(k)) ||
        typeof e.evidenceId !== "string" || !e.evidenceId.length || e.evidenceId.length > 160 || e.evidenceId.trim() !== e.evidenceId ||
        !inTripPresentations.includes(e.presentation as InTripPresentation)) return false;
    const key = `${e.evidenceId}/${e.presentation}`;
    if (identities.has(key)) return false;
    identities.add(key); return true;
  });
}

const contracts: Record<Exclude<InTripPresentation, "uncertainty" | "external-result">, { source: EvidenceSourceType; coverage: EvidenceCoverage[] }> = {
  "planned-itinerary": { source: "trip-state", coverage: ["trip.itinerary", "trip.next-item"] },
  "rail-impact": { source: "trip-impact", coverage: ["rail.impact", "rail.connection"] },
  "environment-impact": { source: "trip-impact", coverage: ["weather.impact", "hazard.impact"] },
  reservation: { source: "reservation-state", coverage: ["reservation.state"] },
  "location-permission": { source: "session-state", coverage: ["location.permission"] },
};

/** A presentation is supported by an Application projection, not an arbitrary Context/model summary. */
export function supportsInTripPresentation(e: Evidence, presentation: InTripPresentation): boolean {
  if (presentation === "external-result") return e.knowledgeKind === "deterministic_fact" &&
    e.references.length > 0 && e.references.every((r) => r.sourceType === "external-source") &&
    ["weather", "hazard"].includes(String(e.facts.resultKind));
  if (!e.references.length || !e.references.every((r) => r.sourceRef.startsWith("application://in-trip/v1/"))) return false;
  if (e.knowledgeKind === "model_interpretation") return false;
  if (e.coverage?.some((c) => c === "weather.impact" || c === "hazard.impact")) return presentation === "environment-impact" &&
    e.references.every((r) => r.sourceType === "trip-impact" && r.sourceRef.endsWith("/environment")) && typeof e.facts.impacts === "string";
  if (presentation === "environment-impact") return false;
  if (presentation === "uncertainty") return e.references.every((r) => ["trip-state", "trip-impact"].includes(r.sourceType)) &&
    (e.knowledgeKind === "unverified_information" || typeof e.facts.typedFacts === "string" &&
      array<Record<string, unknown>>(e.facts.typedFacts).some((f) => f.type === "uncertainty"));
  const c = contracts[presentation];
  if (c.source !== "trip-impact" && e.knowledgeKind !== "deterministic_fact") return false;
  return e.references.length > 0 && e.references.every((r) => r.sourceType === c.source) &&
    c.coverage.some((scope) => e.coverage?.includes(scope));
}

/** No model prose is appended: selecting/order of evidence belongs to the model, facts to this renderer.
 * The saved Impact is displayed, not re-evaluated. Actual location/boarding is never inferred. */
export function renderInTripAnswer(plan: InTripAnswerPlan, used: string[], evidence: Evidence[]): AgentGeneratedResponse {
  if (!validInTripAnswerPlan(plan)) throw new Error("invalid_in_trip_answer_plan");
  const blocks = plan.evidence.map((selection) => {
    const e = evidence.find((item) => item.id === selection.evidenceId);
    if (!e || !used.includes(e.id) || !supportsInTripPresentation(e, selection.presentation)) {
      throw new Error("invalid_in_trip_answer_reference");
    }
    return { evidence: e, text: render(e, selection.presentation) };
  });
  return { text: blocks.map((b) => b.text).join("\n\n"),
    claims: blocks.map((b, i) => ({ id: `in-trip-presentation-${i}`, statement: b.text,
      kind: b.evidence.knowledgeKind === "unverified_information" ? "inference" : "fact", evidenceIds: [b.evidence.id],
      bindings: [{ evidenceId: b.evidence.id, fieldPath: `facts.${Object.keys(b.evidence.facts).sort()[0] ?? ""}`,
        subjectRef: b.evidence.observation?.subjectKey ?? b.evidence.subject,
        ...(b.evidence.observation ? { applicabilityScope: b.evidence.observation.scopeKey } : {}),
        transform: b.evidence.knowledgeKind === "unverified_information" ? "recommendation" as const : "deterministic_calculation" as const }] })) };
}

function render(e: Evidence, presentation: InTripPresentation): string {
  const f = e.facts;
  switch (presentation) {
    case "environment-impact": {
      const impacts = array<InTripContextSnapshot["impacts"]["items"][number]>(f.impacts);
      return impacts.map((i) => {
        const weather = i.facts.some((f) => ["weather-exposure", "weather-placement"].includes(String(f.type)) ||
          f.type === "uncertainty" && String(f.reason).startsWith("weather_"));
        const hazard = i.facts.some((f) => f.type === "hazard-exposure" || f.type === "uncertainty" && String(f.reason).startsWith("hazard_"));
        return `${[...(weather ? ["天気"] : []), ...(hazard ? ["警報"] : [])].join("・")}の保存済み評価: ${severityLabel(i.severity)}（${plain(i.status)}）。\n` +
          i.facts.map(impactFactSummary).join("。\n") + "。" + (i.truncated ? "表示件数の上限により省略された情報があります。" : "");
      }).join("\n\n") + "\n実際の現在地や屋外にいるかは確認していません。未確認は安全を意味しません。" +
        (f.truncated === true ? "未掲載・省略された情報があります。" : "");
    }
    case "external-result": {
      const label = f.resultKind === "weather" ? "天気情報" : "防災情報";
      return (f.status === "available" && f.freshness === "fresh"
        ? `${label}を取得しました。取得内容は構造化カードに表示します。`
        : `${label}の最新情報は確認できていません。`) +
        "取得結果は保存済みの旅程への影響評価とは別です。未確認を問題なしとは扱えず、現在地・乗車状態・施設への適用範囲も推測しません。";
    }
    case "planned-itinerary": {
      if (f.plannedOnly !== true) throw new Error("invalid_planned_evidence");
      const current = array<InTripContextSnapshot["itinerary"]["current"][number]>(f.current);
      const next = array<InTripContextSnapshot["itinerary"]["next"][number]>(f.next);
      const describe = (items: typeof current, label: string) => items.length ?
        `${label}: ${items.map((i) => `「${plain(i.title)}」${scheduleLabel(i.schedule)}`).join("、")}。` : `${label}は未確認です。`;
      return [describe(next, "次の予定"), describe(current, "現在の予定"),
        "これは旅程上の予定で、実際の現在地や乗車を確認した情報ではありません。"].join("\n");
    }
    case "location-permission": {
      const labels: Record<string, string> = { "permission-denied": "位置情報の利用は許可されていません。",
        "not-requested": "位置情報は要求していません。", unavailable: "位置情報を取得できていません。",
        available: "明示許可に基づく位置情報がありますが、この回答用Evidenceには座標を含めていません。" };
      const label = labels[String(f.status)]; if (!label) throw new Error("invalid_location_evidence");
      return `${label}この情報から現在地や現在乗車中かどうかは確認できません。`;
    }
    case "reservation": {
      const labels: Record<string, string> = { booked: "予約済み", pending: "確認待ち", cancelled: "取消済み", "not-booked": "未予約", unknown: "未確認" };
      return array<Record<string, unknown>>(f.reservations).map((r) =>
        `予約記録: ${labels[String(r.status)] ?? "未確認"}。`).join("\n") + "未掲載の予約状態は未確認です。";
    }
    case "uncertainty":
      return "情報には未確認の範囲があります。" + (typeof f.typedFacts === "string"
        ? array<Record<string, unknown>>(f.typedFacts).filter((v) => v.type === "uncertainty").map(impactFactSummary).join("。")
        : `影響情報: ${plain(String(f.impacts))}、予約情報: ${plain(String(f.reservations))}。`) +
        "未確認・省略された情報を問題なしとは扱えません。";
    default: {
      const allowed = ["rail-delay", "connection-buffer", "schedule-risk", "rail-observation", "reservation-risk", "uncertainty"];
      const facts = array<Record<string, unknown>>(f.typedFacts).filter((v) => allowed.includes(String(v.type)));
      return `鉄道の保存済み評価: ${severityLabel(String(f.severity))}（${plain(String(f.status))}）。\n` +
        facts.map(impactFactSummary).join("。\n") + "。\n実際に現在その列車へ乗車しているかは確認できていません。未確認は安全を意味しません。" +
        (f.truncated === true ? "表示件数の上限により省略された情報があります。" : "");
    }
  }
}

function severityLabel(value: string): string {
  const labels: Record<string, string> = { critical: "重大な対応が必要", "action-required": "対応が必要", attention: "注意が必要", informational: "参考情報" };
  return labels[value] ?? "未確認";
}

function scheduleLabel(s: InTripContextSnapshot["itinerary"]["current"][number]["schedule"]): string {
  if (s.type === "fixed") return `（${new Intl.DateTimeFormat("ja-JP", { timeZone: s.startAt.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s.startAt.at))}からの予定）`;
  if (s.type === "day") return `（${s.date}、日付単位の予定）`;
  if (s.type === "window") return "（時間幅のある予定・possible-currentは未確定）";
  return "（時刻未設定）";
}
function array<T>(value: unknown): T[] {
  if (typeof value !== "string") throw new Error("invalid_presentation_facts");
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 8) throw new Error("invalid_presentation_facts");
  return parsed as T[];
}
function record(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function plain(value: string): string { return value.replace(/[<>\[\]*_`]/gu, ""); }
