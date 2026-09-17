import type { Trip } from "@raiquora/trip/trip";
import type { ImpactNotificationObservation, NotificationEpisode, TripNotification } from "@raiquora/trip/notification";
import type { NotificationDecision } from "@raiquora/trip/notification-policy";
import type { TripPrincipal } from "./trip-repository.js";

export interface NotificationWorkKey { pk: string; sk: string }
export interface NotificationWork {
  key: NotificationWorkKey; version: number; attempt: number;
  kind?: "signal" | "delivery";
  observation?: ImpactNotificationObservation;
  notificationId?: string;
}
export interface NotificationRepository {
  due(now: number): Promise<NotificationWorkKey[]>;
  claim(key: NotificationWorkKey, now: number): Promise<NotificationWork | undefined>;
  finish(work: NotificationWork, state: "done" | "pending" | "dead", now: number): Promise<void>;
  observation(principal: TripPrincipal, tripId: string, subjectKey: string): Promise<ImpactNotificationObservation | undefined>;
  episode(principal: TripPrincipal, tripId: string, revision: number, subjectKey: string): Promise<NotificationEpisode | undefined>;
  commitDecision(work: NotificationWork, trip: Trip, previous: NotificationEpisode | undefined, decision: NotificationDecision, now: number): Promise<void>;
  get(principal: TripPrincipal, id: string): Promise<TripNotification | undefined>;
  list(principal: TripPrincipal, after?: string): Promise<{ notifications: TripNotification[]; after?: string }>;
  markRead(principal: TripPrincipal, id: string, version: number, now: string): Promise<void>;
  completeDelivery(work: NotificationWork, notification: TripNotification, status: "sent" | "suppressed" | "failed", now: string): Promise<void>;
}
export interface NotificationDelivery {
  /** Channel must persist the dedupe key before acknowledging; retry never creates a new notification ID. */
  send(principal: TripPrincipal, notification: TripNotification, idempotencyKey: string): Promise<"delivered" | "disabled">;
}
export type NotificationMetric = "Decisions" | "Notify" | "Suppress" | "Resolve" | "Unknown" | "DuplicateSuppressed" | "Escalated" |
  "Queued" | "Sent" | "Retry" | "Failed" | "DLQ" | "DeliveryLatencyMs" | "Due" | "PollSuccess";
export interface NotificationMetrics { record(name: NotificationMetric, value: number): void }
export const notificationDeliveryPolicy = { shards: 4, pageSize: 5, leaseMs: 240000, maxAttempts: 8 } as const;
export const notificationBackoff = (attempt: number) => Math.min(1800000, 30000 * 2 ** Math.max(0, attempt - 1));
