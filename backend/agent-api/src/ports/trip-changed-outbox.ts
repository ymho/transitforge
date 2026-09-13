import type { TripChanged } from "../contracts/trip-changed.js";

/** Opaque trusted database keys. Public callers do not supply tasks or owner routing. */
export interface OutboxKey { pk: string; sk: string }
export interface OutboxClaim {
  key: OutboxKey;
  version: number;
  attempt: number;
  event?: TripChanged; // malformed payload is isolated to DLQ, never reconciled
}
export interface TripChangedOutbox {
  due(now: number): Promise<OutboxKey[]>;
  claim(key: OutboxKey, now: number): Promise<OutboxClaim | undefined>;
  finish(claim: OutboxClaim, state: "done" | "pending" | "dead", now: number): Promise<void>;
}
export const tripChangedDelivery = { shards: 4, pageSize: 10, maxAttempts: 8, leaseMs: 120_000 } as const;
export function tripChangedBackoff(attempt: number): number {
  return Math.min(1_800_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}
