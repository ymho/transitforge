import { createTrip, type Trip } from "@raiquora/trip/trip";
import type { TripWorkspaceSource } from "../usecases/trip-plan/trip-workspace-controller";

/** Development-only, read-only source. No writer, provider claims, real booking or server connection. */
export function homePreviewSource(): TripWorkspaceSource {
  const trip: Trip = { ...createTrip("45300000-0000-4000-8000-000000000001", "ゆっくり街を歩く旅（開発サンプル）", "2026-09-18T00:00:00Z", [
    { id: "walk", type: "activity", category: "free-time", title: "街歩き（サンプル・未調査）", schedule: { type: "day", date: "2026-10-20", timeZone: "Asia/Tokyo" } },
  ]), adoption: { confirmedAt: "2026-09-18T00:00:00Z" } };
  return { getCurrentTrip: () => structuredClone(trip), getLoadState: () => "loaded" };
}
