import { exactKeys, validInstant } from "./snapshot-validation";
import { monitoringText, monitoringRevision } from "./trip-watch";

export const notificationPolicyVersion = "trip-notification-v1";
export type NotificationSeverity = "attention" | "action-required" | "critical";
export interface ImpactNotificationObservation {
  readonly tripId: string;
  readonly tripRevision: number;
  readonly impactId: string;
  readonly subjectKey: string;
  readonly kind: "rail-operation" | "weather" | "hazard";
  readonly observedAt: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly fresh: boolean;
}
export interface NotificationEpisode {
  readonly id: string;
  readonly version: number;
  readonly tripId: string;
  readonly tripRevision: number;
  readonly subjectKey: string;
  readonly generation: number;
  readonly openedAt: string;
  readonly state: "open" | "resolved";
  readonly latestOrder: string;
  readonly latestImpactId: string;
  readonly highestSeverity: NotificationSeverity;
  readonly highestRisk: Readonly<Record<string, number>>;
  readonly latestNotificationId?: string;
}
export interface TripNotification {
  readonly id: string;
  readonly version: number;
  readonly tripId: string;
  readonly tripRevision: number;
  readonly impactId: string;
  readonly episodeId: string;
  readonly subjectKey: string;
  readonly type: "travel-impact";
  readonly severity: NotificationSeverity;
  readonly status: "pending" | "sent" | "failed" | "suppressed" | "read";
  readonly phase: "warning" | "resolved";
  readonly dedupeKey: string;
  readonly createdAt: string;
  readonly sentAt?: string;
  readonly readAt?: string;
  readonly itemIds: readonly string[];
  readonly message: string;
}
export type NotificationCurrency = "current" | "historical" | "unconfirmed";
/** Public allowlist: excludes internal episode, Impact identity (which contains measurements), and owner. */
export interface NotificationView {
  readonly id: string;
  readonly version: number;
  readonly tripId: string;
  readonly tripRevision: number;
  readonly itemIds: readonly string[];
  readonly severity: NotificationSeverity;
  readonly status: TripNotification["status"];
  readonly phase: TripNotification["phase"];
  readonly createdAt: string;
  readonly message: string;
  readonly currency: NotificationCurrency;
}
export const observationOrder = (o: ImpactNotificationObservation) => `${new Date(o.observedAt).toISOString()}|${new Date(o.evaluatedAt).toISOString()}`;
export function validateNotificationObservation(o: ImpactNotificationObservation): void {
  exactKeys(o, ["tripId", "tripRevision", "impactId", "subjectKey", "kind", "observedAt", "evaluatedAt", "expiresAt", "fresh"]);
  monitoringText(o.tripId); monitoringRevision(o.tripRevision); monitoringText(o.impactId, 250000); monitoringText(o.subjectKey, 4000);
  if (!["rail-operation", "weather", "hazard"].includes(o.kind) || typeof o.fresh !== "boolean" ||
      ![o.observedAt, o.evaluatedAt, o.expiresAt].every(validInstant) || Date.parse(o.observedAt) > Date.parse(o.evaluatedAt)) throw new Error("Invalid notification observation");
}
export function validateNotification(n: TripNotification): void {
  exactKeys(n, ["id", "version", "tripId", "tripRevision", "impactId", "episodeId", "subjectKey", "type", "severity", "status", "phase", "dedupeKey", "createdAt", "sentAt", "readAt", "itemIds", "message"]);
  for (const s of [n.id, n.episodeId, n.dedupeKey]) if (!/^[a-f0-9]{64}$/.test(s)) throw new Error("Invalid opaque notification ID");
  monitoringText(n.tripId); monitoringRevision(n.tripRevision); monitoringRevision(n.version);
  monitoringText(n.impactId, 250000); monitoringText(n.subjectKey, 4000); monitoringText(n.message, 2000);
  if (n.type !== "travel-impact" || !["attention", "action-required", "critical"].includes(n.severity) ||
      !["pending", "sent", "failed", "suppressed", "read"].includes(n.status) || !["warning", "resolved"].includes(n.phase) ||
      !validInstant(n.createdAt) || n.sentAt !== undefined && (!validInstant(n.sentAt) || Date.parse(n.sentAt) < Date.parse(n.createdAt)) ||
      n.readAt !== undefined && (!validInstant(n.readAt) || Date.parse(n.readAt) < Date.parse(n.createdAt)) ||
      n.status === "read" && !n.readAt || n.status === "sent" && !n.sentAt ||
      !Array.isArray(n.itemIds) || !n.itemIds.length || n.itemIds.length > 200 || new Set(n.itemIds).size !== n.itemIds.length) throw new Error("Invalid notification");
  n.itemIds.forEach((id) => monitoringText(id));
}
export function validateNotificationEpisode(e: NotificationEpisode): void {
  exactKeys(e, ["id", "version", "tripId", "tripRevision", "subjectKey", "generation", "openedAt", "state", "latestOrder", "latestImpactId", "highestSeverity", "highestRisk", "latestNotificationId"]);
  if (!/^[a-f0-9]{64}$/.test(e.id) || e.latestNotificationId !== undefined && !/^[a-f0-9]{64}$/.test(e.latestNotificationId)) throw new Error("Invalid episode ID");
  monitoringRevision(e.version); monitoringRevision(e.tripRevision); monitoringRevision(e.generation);
  monitoringText(e.tripId); monitoringText(e.subjectKey, 4000); monitoringText(e.latestImpactId, 250000);
  if (!validInstant(e.openedAt) || !["open", "resolved"].includes(e.state) || !["attention", "action-required", "critical"].includes(e.highestSeverity) ||
      e.latestOrder.split("|").length !== 2 || !e.latestOrder.split("|").every(validInstant) ||
      !e.highestRisk || typeof e.highestRisk !== "object" || Array.isArray(e.highestRisk) || Object.keys(e.highestRisk).length > 2000) throw new Error("Invalid episode");
  for (const [key, value] of Object.entries(e.highestRisk)) { monitoringText(key, 1000); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid risk level"); }
}
export function notificationView(n: TripNotification, currency: NotificationCurrency): NotificationView {
  validateNotification(n);
  return { id: n.id, version: n.version, tripId: n.tripId, tripRevision: n.tripRevision, itemIds: [...n.itemIds], severity: n.severity,
    status: n.status, phase: n.phase, createdAt: n.createdAt, message: n.message, currency };
}
export function validateNotificationView(v: NotificationView): void {
  exactKeys(v, ["id", "version", "tripId", "tripRevision", "itemIds", "severity", "status", "phase", "createdAt", "message", "currency"]);
  if (!/^[a-f0-9]{64}$/.test(v.id) || !/^[a-f0-9-]{36}$/i.test(v.tripId) || !validInstant(v.createdAt) ||
      !["attention", "action-required", "critical"].includes(v.severity) || !["pending", "sent", "failed", "suppressed", "read"].includes(v.status) ||
      !["warning", "resolved"].includes(v.phase) || !["current", "historical", "unconfirmed"].includes(v.currency) ||
      !Array.isArray(v.itemIds) || !v.itemIds.length || v.itemIds.length > 200) throw new Error("Invalid notification view");
  monitoringRevision(v.version); monitoringRevision(v.tripRevision); monitoringText(v.message, 2000); v.itemIds.forEach((id) => monitoringText(id));
}
