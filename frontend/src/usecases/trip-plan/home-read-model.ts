import { classifyTrips, type ClassifiedTrip } from "@raiquora/trip/trip-adoption";
import type { Trip } from "@raiquora/trip/trip";

/** Read projection for the dedicated Trips screen; Home itself is only Hero + consultation entry. */
export interface HomeReadInput {
  state: "loading" | "available" | "unavailable" | "unauthenticated";
  trips: readonly Trip[];
}
export function homeReadModel(input: HomeReadInput, now: Date) {
  const trips = input.state === "available" ? classifyTrips(input.trips, { now: () => now }) : [];
  return { state: input.state, trips };
}
export const tripDisplayLabels: Record<ClassifiedTrip["group"], string> = {
  next: "次の旅", scheduled: "予定あり", current: "現在の旅行予定", planning: "計画中", "past-plan": "過去の予定", completed: "終了した旅", cancelled: "中止した旅",
};
