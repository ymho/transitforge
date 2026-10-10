import type { Trip } from "@raiquora/trip/trip";
import type { OfficialGuide } from "@raiquora/trip/official-guide";
import type { TripRole } from "@raiquora/trip/trip-sharing";
export interface TripLibraryClient {
  accessible(after?: string): Promise<{ trips: { trip: Trip; role: TripRole }[]; afterTripId?: string }>;
  ownedShared(after?: string): Promise<{ trips: { trip: Trip; role: TripRole }[]; afterTripId?: string }>;
  officialCapabilities(): Promise<boolean>;
  officialList(after?: string): Promise<{ guides: OfficialGuide[]; after?: string }>;
  officialGet(id: string): Promise<OfficialGuide>;
  officialPublish(trip: Trip): Promise<void>;
  officialWithdraw(guide: OfficialGuide): Promise<void>;
  officialImport(guide: OfficialGuide, newTripId: string, startDate: string, adults: number, children: number): Promise<Trip>;
}
