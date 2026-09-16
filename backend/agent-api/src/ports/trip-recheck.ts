import type { Trip } from "@raiquora/trip/trip";
import type { TripWatch, ResolvedWatchScope } from "@raiquora/trip/trip-watch";
import type { TravelEvent } from "@raiquora/trip/travel-event";
import type { TripRecheckTask } from "../contracts/trip-recheck.js";
import type { TripPrincipal } from "./trip-repository.js";

export interface RecheckKey { pk: string; sk: string }
export interface RecheckClaim {
  key: RecheckKey; version: number; attempt: number; replay: number; cycleStartedAt: number; dueAt: number;
  task?: TripRecheckTask;
}
export type RecheckCompletion = { state: "inactive" | "dead" } |
  { state: "pending"; dueAt: number; attempt: number; replay: number; cycleStartedAt: number };
export interface TripRecheckRepository {
  ensure(principal: TripPrincipal, task: TripRecheckTask): Promise<void>;
  due(now: number): Promise<RecheckKey[]>;
  claim(key: RecheckKey, now: number): Promise<RecheckClaim | undefined>;
  finish(claim: RecheckClaim, completion: RecheckCompletion): Promise<void>;
}
export const recheckDelivery = { shards: 4, pageSize: 5, leaseMs: 240_000, maxAttempts: 8, replayPasses: 3, replayWindowMs: 15 * 60_000 } as const;
export function recheckBackoff(attempt: number): number { return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1)); }
export interface RecheckScopeResolver {
  resolve(trip: Trip): Promise<{ scopes: ResolvedWatchScope[]; unresolved: boolean }>;
}
export interface RecheckEventSource {
  /** Resolve from current saved Watch + current Place evidence. Never trust a task's target snapshot. */
  events(trip: Trip, watch: TripWatch, now: number): Promise<TravelEvent[]>;
}
export type RecheckMetric = "DueTasks" | "Claimed" | "Executed" | "StaleRevisionSkip" | "ProviderSuccess" | "ProviderFailure" |
  "ProviderTimeout" | "ProviderRateLimit" | "EventGenerated" | "ImpactSaved" | "ReplayRequired" | "ReplaySuccess" |
  "RecheckLagMs" | "DLQ" | "Retry" | "TargetUnknown" | "PollSuccess";
export interface RecheckMetrics { record(name: RecheckMetric, value: number): void }
