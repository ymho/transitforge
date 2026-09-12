import type { TransferPace } from "./journey-search-preferences";

/** Shared timetable transfer rule; search and selected-plan validation must agree. */
export function requiredTransferMinutes(base: number, pace: TransferPace): number {
  if (!Number.isFinite(base) || base < 0) throw new Error("Invalid transfer rule");
  return pace === "hurried" ? Math.max(2, Math.round(base * .7 * 10) / 10)
    : pace === "relaxed" ? Math.max(2, base + 5) : Math.max(2, base);
}
