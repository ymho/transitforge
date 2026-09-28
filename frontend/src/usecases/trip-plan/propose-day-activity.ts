import type { ActivityCategory, Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import { proposeTripItemChange } from "@raiquora/trip/trip-item-proposal";

/** A day selection is a plan intention, never a verified venue or a clock time. */
export function proposeDayActivity(trip: Trip, input: {
  itemId: string; title: string; category: ActivityCategory; dayKey: string; afterId?: string; placeName?: string;
}): TripUpdateProposal {
  return proposeTripItemChange(trip, { action: "add-activity", ...input });
}
