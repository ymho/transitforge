import type { TripChecklistItem } from "@raiquora/trip/trip-checklist";
import type { TripPrincipal } from "./trip-repository.js";

/** Complete owner/Trip read; version is a persistence collection CAS, not Trip.revision. */
export interface ChecklistRead {
  items: TripChecklistItem[];
  version: number;
}
export interface ChecklistWrite {
  item: TripChecklistItem;
  baseRevision?: number; // absent = create; present = strict replace
}
export interface ChecklistRepository {
  read(principal: TripPrincipal, tripId: string): Promise<ChecklistRead>;
  /** Atomically guards the collection version and every individual item revision. */
  commit(principal: TripPrincipal, tripId: string, version: number, writes: readonly ChecklistWrite[]): Promise<void>;
}
