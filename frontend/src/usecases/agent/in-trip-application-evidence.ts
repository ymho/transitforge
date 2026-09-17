import { validateInTripContext, type InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import type { Evidence, EvidenceKnowledgeKind, EvidenceSourceType, EvidenceFreshness } from "./evidence-model";

/** Pure Agent-layer projection of the validated owner-scoped read result, not arbitrary Context.
 * At most 10 entries: itinerary + six impacts + reservations + session + coverage.
 * Source refs address this execution's snapshot, never owner/provider/private resource IDs. */
export function inTripApplicationEvidence(snapshot: InTripContextSnapshot): Evidence[] {
  validateInTripContext(snapshot);
  if (snapshot.trip.currency !== "current") return [];
  const evidence: Evidence[] = [];
  const add = (part: string, sourceType: EvidenceSourceType, knowledgeKind: EvidenceKnowledgeKind,
    summary: string, facts: Evidence["facts"], freshness: EvidenceFreshness = "current") => {
    evidence.push({ id: `application:in-trip:${part}`, category: "external", knowledgeKind, subject: `inTrip.${part}`,
      facts, references: [{ sourceType, sourceRef: `application://in-trip/v1/${snapshot.trip.revision}/${part}`,
        retrievedAt: snapshot.now.at, freshness, summary }] });
  };
  const { current, next } = snapshot.itinerary;
  const label = (items: typeof current) => items.map((i) => `${i.title.slice(0, 25)}(${i.schedule.type}${i.schedule.type === "fixed" ? `,${i.schedule.startAt.at}` : ""}${i.rail ? `,列車${i.rail.map((leg) => leg.trainNumber).join("/")}` : ""})`).join("、") || "未確認";
  add("itinerary", "trip-state", "deterministic_fact",
    `採用済み計画。次: ${label(next)}。現在（予定）: ${label(current)}。予定上のcurrentは実際の現在地・乗車確認ではない。時間精度を保持する。`,
    { current: JSON.stringify(current), next: JSON.stringify(next), now: snapshot.now.at, timeZone: snapshot.now.timeZone,
      plannedOnly: true, omitted: snapshot.itinerary.omitted }, "scheduled");
  if (snapshot.impacts.status !== "unavailable") snapshot.impacts.items.forEach((impact, index) => {
    add(`impacts/${index}`, "trip-impact", impact.status === "unknown" ? "unverified_information" : "derived_value",
      `保存済みImpact[${index}]: ${impact.status}, ${impact.severity}。${impact.facts.map(impactFactSummary).join("。")}。未確認は安全を意味しない。数値・severityは保存済み判定であり再計算しない。`,
      { status: impact.status, severity: impact.severity, affectedItemIds: [...impact.affectedItemIds],
        typedFacts: JSON.stringify(impact.facts), evaluatedAt: impact.evaluatedAt, observedAt: impact.observedAt,
        expiresAt: impact.expiresAt, truncated: impact.truncated }, impact.status === "unknown" ? "unknown" : "current");
  });
  const relevant = new Set([...current, ...next].map((i) => i.itemId));
  const reservations = snapshot.reservations.status === "available" ? snapshot.reservations.items.filter((r) =>
    r.itineraryItemId && relevant.has(r.itineraryItemId) && r.status !== "unknown") : [];
  if (reservations.length) add("reservations", "reservation-state", "deterministic_fact",
    "現在/次予定に紐づくReservationFactの記録。採用済み計画と予約状態は別。不明・未掲載の予約がないとは断定しない。",
    { reservations: JSON.stringify(reservations), omitted: snapshot.reservations.omitted });
  add("location", "session-state", "deterministic_fact",
    `位置情報:${snapshot.location.status}（${{ "permission-denied": "利用者は位置情報へのアクセスを許可していない", "not-requested": "位置情報を要求していない", unavailable: "位置情報を取得できない", available: "明示許可に基づく位置情報あり" }[snapshot.location.status]}）。予定から現在地・乗車を推定しない。`,
    { status: snapshot.location.status });
  add("coverage", "trip-state", "unverified_information",
    "unknown/unavailable/truncated/omittedは未確認範囲であり問題なしではない。未確認と説明でき、ユーザーへの質問が必須という意味ではない。",
    { impacts: snapshot.impacts.status, impactOmitted: snapshot.impacts.omitted,
      reservations: snapshot.reservations.status, reservationOmitted: snapshot.reservations.omitted,
      truncated: snapshot.truncation.truncated }, "unknown");
  return evidence;
}

/** Render saved measurements only; no transfer calculation, risk classification or recommendation. */
function impactFactSummary(f: Record<string, unknown>): string {
  switch (f.type) {
    case "rail-delay": return `列車遅延${f.delayMinutes}分`;
    case "connection-buffer": return `乗換余裕:計画${f.scheduledMinutes}分/見込み${f.projectedMinutes}分/必要${f.requiredMinutes}分（${f.departureBasis}）`;
    case "uncertainty": return `未確認:${f.reason}`;
    case "rail-observation": return `列車観測:${f.observation}`;
    case "weather-exposure": return `予報:${f.temperatureCelsius}℃/降水${f.precipitationMillimeters}mm/確率${f.precipitationProbabilityPercent}%/関連度${f.relevance}`;
    case "weather-placement": return `降水と予定時間の関連度:${f.relevance}`;
    case "hazard-exposure": return `警報:${f.category}/${f.publicSeverity}、範囲${f.coverage}（施設の危険を断定しない）`;
    case "schedule-risk": return `到着見込み${(f.projectedArrivalAt as { at: string }).at}/次予定${(f.targetStartAt as { at: string }).at}`;
    case "reservation-risk": return `予約への影響（予約詳細は再取得せずinTripの記録を参照）`;
    default: throw new Error("Unsupported validated Impact fact");
  }
}
