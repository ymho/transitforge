import type { TripChecklistItem } from "./trip-checklist";
import { feasibilityTrip } from "./trip-feasibility.fixture";
export const checklistItem = (changes: Partial<TripChecklistItem> = {}): TripChecklistItem => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tripId: feasibilityTrip().id, schemaVersion: 1, revision: 0,
  category: "connectivity", title: "SIM", status: "open", source: "user", archived: false, ...changes,
});
