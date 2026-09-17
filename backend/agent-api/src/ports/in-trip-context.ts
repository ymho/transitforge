import type { ImpactNotificationObservation } from "@raiquora/trip/notification";
import type { TripPrincipal } from "./trip-repository.js";

/** Latest committed Impact pointer per subject, independent of notification eligibility/state. */
export interface TripObservationReader {
  observations(principal: TripPrincipal, tripId: string): Promise<{ observations: ImpactNotificationObservation[]; truncated: boolean }>;
}
