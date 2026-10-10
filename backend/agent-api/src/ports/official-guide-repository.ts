import type { OfficialGuide } from "@raiquora/trip/official-guide";
import type { Trip } from "@raiquora/trip/trip";
import type { TripPrincipal } from "../contracts/trip-principal.js";
export interface OfficialGuideRecord { guide: OfficialGuide; publisher: string; active: boolean }
export interface OfficialGuideRepository {
  get(id: string): Promise<OfficialGuideRecord | undefined>;
  list(after?: string): Promise<{ guides: OfficialGuide[]; after?: string }>;
  publish(owner: TripPrincipal, source: Trip, next: OfficialGuideRecord, previous?: OfficialGuideRecord): Promise<void>;
  import(principal: TripPrincipal, source: OfficialGuideRecord, trip: Trip, requestKey: string): Promise<Trip>;
  withdraw(owner: TripPrincipal, old: OfficialGuideRecord): Promise<void>;
}
