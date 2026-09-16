import { validateTrip, type Trip } from "./trip";
import { validateTripImpact, type TripImpact } from "./trip-impact";
import { monitoringKey } from "./trip-watch";
import { recheckEnvelope } from "./trip-recheck";
import { validInstant } from "./snapshot-validation";
import { notificationPolicyVersion, observationOrder, validateNotificationObservation, validateNotificationEpisode,
  type ImpactNotificationObservation, type NotificationEpisode, type NotificationSeverity, type TripNotification } from "./notification";

export type NotificationReason = "stale-trip" | "stale-observation" | "outside-window" | "schedule-unknown" | "unknown-facts" | "informational" |
  "duplicate" | "risk-escalated" | "new-episode" | "resolved" | "no-impact";
export interface NotificationDecision {
  readonly action: "notify" | "suppress" | "resolve" | "unknown";
  readonly reason: NotificationReason;
  readonly episode?: NotificationEpisode;
  readonly notification?: TripNotification;
}
const rank = (s: NotificationSeverity) => ["attention", "action-required", "critical"].indexOf(s);
/** Typed measurements only. No place/title/provider prose, booking reference or suggested alternative. */
export function notificationRisk(impact: TripImpact) {
  const risk: Record<string, number> = Object.create(null), messages: string[] = [];
  const record = (key: unknown[], level: number, message: string) => { const k = monitoringKey(key); risk[k] = Math.max(risk[k] ?? 0, level); if (!messages.includes(message)) messages.push(message); };
  for (const f of impact.facts) {
    if (f.type === "connection-buffer") {
      const margin = f.projectedMinutes - f.requiredMinutes;
      const level = margin < 0 ? 4 + Math.ceil(-margin / 5) : margin < 2 ? 3 : margin < 5 ? 2 : 1;
      record([f.type, f.itemId, f.fromLegId, f.toLegId], level, `列車の遅れにより、接続の乗換余裕が${f.projectedMinutes}分になる見込みです（必要${f.requiredMinutes}分）。次の列車の発車は${f.departureBasis === "scheduled" ? "計画時刻" : "観測された遅延"}を基準としています。`);
    } else if (f.type === "schedule-risk") {
      const minutes = Math.ceil((Date.parse(f.projectedArrivalAt.at) - Date.parse(f.targetStartAt.at)) / 60000);
      record([f.type, f.fromItemId, f.toItemId], Math.ceil(minutes / 5), `到着見込みが後続予定の${f.targetBasis === "fixed" ? "開始" : "最遅開始"}を${minutes}分超過しています。後続予定への影響を確認してください。`);
    } else if (f.type === "reservation-risk") {
      const minutes = Math.ceil((Date.parse(f.projectedArrivalAt.at) - Date.parse(f.bookedStartAt.at)) / 60000);
      record([f.type, f.itemId], Math.ceil(minutes / 5), `到着見込みが予約予定の開始を${minutes}分超過しています。予約内容を確認してください。`);
    } else if (f.type === "rail-observation" && f.observation === "cancelled") {
      record([f.type, f.itemId, f.legId], 100, "乗車予定の列車について、運休の観測があります。現在の運行情報と旅程を確認してください。");
    } else if (f.type === "weather-exposure" && f.precipitationMillimeters > 0) {
      record(["weather", f.itemId], 1, "予定時間帯に降水の予報があります。予定への影響を確認してください。施設の営業や旅行の中止を判断する情報ではありません。");
    } else if (f.type === "hazard-exposure") {
      record(["hazard", f.itemId, f.category], ["unknown", "advisory", "warning", "emergency"].indexOf(f.publicSeverity) + 1,
        "予定に関係する検索区域で防災情報を取得しました。対象施設への適用範囲・警報の有効期間は未確認です。公式情報を確認してください。この施設が危険と判定したものではありません。");
    }
  }
  // Delay alone does not create a notification, but a concrete risk worsening by five minutes can escalate one.
  if (messages.length) for (const f of impact.facts) if (f.type === "rail-delay") risk[monitoringKey([f.type, f.itemId, f.legId])] = Math.floor(f.delayMinutes / 5);
  return { risk, message: messages.slice(0, 3).join("\n") };
}
/** Hash is an injected deterministic identity primitive, never randomness, wall-clock or model output. */
export function decideNotification(trip: Trip | undefined, impact: TripImpact, observation: ImpactNotificationObservation,
  previous: NotificationEpisode | undefined, now: string, hash: (canonical: string) => string): NotificationDecision {
  validateTripImpact(impact); validateNotificationObservation(observation); if (previous) validateNotificationEpisode(previous);
  if (!validInstant(now)) throw new Error("Invalid notification clock");
  if (trip) validateTrip(trip);
  if (!trip || ["cancelled", "completed"].includes(trip.lifecycleState) || trip.id !== impact.tripId || trip.revision !== impact.tripRevision ||
      impact.affectedItemIds.some((id) => !trip.items.some((i) => i.id === id))) return { action: "suppress", reason: "stale-trip" };
  if (observation.impactId !== impact.id || observation.tripId !== trip.id || observation.tripRevision !== trip.revision) throw new Error("Observation mismatch");
  if (previous && (previous.tripId !== trip.id || previous.tripRevision !== trip.revision || previous.subjectKey !== observation.subjectKey)) throw new Error("Episode mismatch");
  const order = observationOrder(observation), timestamp = Date.parse(now);
  if (previous && order <= previous.latestOrder) return { action: "suppress", reason: "duplicate" };
  const unchanged = previous ? { ...previous, version: previous.version + 1, latestOrder: order, latestImpactId: impact.id } : undefined;
  if (!observation.fresh || timestamp >= Date.parse(observation.expiresAt) || timestamp < Date.parse(observation.observedAt))
    return { action: "unknown", reason: "stale-observation", episode: unchanged };
  const spans = trip.items.filter((i) => impact.affectedItemIds.includes(i.id)).map((i) => recheckEnvelope(i.schedule));
  if (!spans.some(Boolean)) return { action: "unknown", reason: "schedule-unknown", episode: unchanged };
  if (!spans.some((span) => span && span.start - 86400000 <= timestamp && span.end >= timestamp))
    return { action: "suppress", reason: "outside-window", episode: unchanged };
  if (impact.status === "unknown") return { action: "unknown", reason: "unknown-facts", episode: unchanged };
  if (impact.status === "no-impact") {
    // Neither partial coverage nor an empty fanout is proof of recovery.
    if (impact.facts.some((f) => f.type === "uncertainty") || observation.kind !== "rail-operation" ||
        !impact.facts.some((f) => f.type === "rail-delay") || !previous || previous.state === "resolved")
      return { action: "suppress", reason: "no-impact", episode: unchanged };
    const episode = { ...unchanged!, state: "resolved" as const };
    if (rank(previous.highestSeverity) < 1) return { action: "resolve", reason: "resolved", episode };
    return make("resolve", "resolved", episode, "確認できた列車の遅れによる接続・予定への影響は、この評価では検出されなくなりました。旅行全体の安全を保証するものではありません。", "resolved", previous.highestSeverity);
  }
  if (impact.severity === "informational") return { action: "suppress", reason: "informational", episode: unchanged };
  const { risk, message } = notificationRisk(impact);
  if (!message) return { action: "unknown", reason: "unknown-facts", episode: unchanged };
  // Query-limited hazard never inherits a public emergency's severity as a facility danger claim.
  const severity: NotificationSeverity = observation.kind === "hazard" ? "attention" : impact.severity;
  const reopen = !previous || previous.state === "resolved";
  if (!reopen && rank(severity) <= rank(previous.highestSeverity) && Object.entries(risk).every(([k, v]) => v <= (previous.highestRisk[k] ?? 0)))
    return { action: "suppress", reason: "duplicate", episode: unchanged };
  const generation = reopen ? (previous?.generation ?? -1) + 1 : previous.generation;
  const episode: NotificationEpisode = {
    id: reopen ? hash(monitoringKey([notificationPolicyVersion, trip.id, trip.revision, observation.subjectKey, generation, order])) : previous.id,
    version: (previous?.version ?? -1) + 1, tripId: trip.id, tripRevision: trip.revision, subjectKey: observation.subjectKey, generation,
    openedAt: reopen ? now : previous.openedAt, state: "open", latestOrder: order, latestImpactId: impact.id,
    highestSeverity: !reopen && rank(previous.highestSeverity) > rank(severity) ? previous.highestSeverity : severity,
    highestRisk: Object.fromEntries([...new Set([...Object.keys(reopen ? {} : previous.highestRisk), ...Object.keys(risk)])].map((k) => [k, Math.max(risk[k] ?? 0, reopen ? 0 : previous.highestRisk[k] ?? 0)])),
  };
  return make("notify", reopen ? "new-episode" : "risk-escalated", episode, message, "warning", severity);

  function make(action: "notify" | "resolve", reason: NotificationReason, episode: NotificationEpisode, message: string, phase: TripNotification["phase"], severity: NotificationSeverity): NotificationDecision {
    const id = hash(monitoringKey([notificationPolicyVersion, episode.id, order, impact.id, phase]));
    return { action, reason, episode: { ...episode, latestNotificationId: id }, notification: { id, dedupeKey: id, version: 0, tripId: impact.tripId,
      tripRevision: impact.tripRevision, impactId: impact.id, episodeId: episode.id, subjectKey: observation.subjectKey, type: "travel-impact",
      severity, status: "pending", phase, createdAt: now, itemIds: [...impact.affectedItemIds], message } };
  }
}
