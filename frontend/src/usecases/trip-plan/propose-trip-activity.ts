import type { ExperienceOffering } from "@raiquora/trip/travel-candidate";
import type { RestaurantCandidate } from "@raiquora/trip/restaurant-search";
import type { ExternalSourceEvidence } from "@raiquora/trip/external-travel-information";
import { createPlaceSnapshot, type PlaceSnapshot, type PlaceSnapshotRetention } from "@raiquora/trip/place-snapshot";
import { validInstant, exactKeys } from "@raiquora/trip/selected-rail-journey";
import { validateItinerarySchedule, type ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import { type Trip, type TripUpdateProposal, type ActivityCategory } from "@raiquora/trip/trip";
import { proposeItineraryItem as proposalFor, type ItineraryPlacement } from "./itinerary-proposal";

/** Ephemeral trusted lookup, not an Offering/Trip repository. Resolver owns matching (#377),
 * provider evidence and field-specific retention. A model cannot supply this record. */
export type ResolvedActivityCandidate = {
  candidateId: string; tripId: string; taskId: string; validUntil: string;
  provider: string; providerItemId: string;
  source: ExternalSourceEvidence;
  place: PlaceSnapshot;
  placeRetention: PlaceSnapshotRetention;
  retainTitle: boolean;
  retainSchedule: boolean;
} & ({ kind: "restaurant"; result: RestaurantCandidate } | { kind: "experience"; result: ExperienceOffering });
export interface ActivitySelectionPort {
  /** More than one matching record is ambiguous, never implicitly take the first. */
  resolve(candidateId: string): Promise<readonly ResolvedActivityCandidate[]>;
}
export type ActivityPlacement = ItineraryPlacement;

/** User-authored plan intention, not a claim that a venue/booking exists. Provider-backed
 * places must use the ID-resolving entry below; the model-facing manual Tool has no Place input. */
export function proposeManualActivity(trip: Trip, placement: ActivityPlacement,
  input: { title: string; category: ActivityCategory; schedule: ItinerarySchedule; place?: PlaceSnapshot }): TripUpdateProposal {
  exactKeys(input, ["title", "category", "schedule", "place"]);
  const place = input.place ? createPlaceSnapshot(input.place, { origin: "manual" }) : undefined;
  if (input.place) exactKeys(input.place, ["ref", "name", "address", "coordinate", "area", "timeZone", "capturedAt", "sources"]);
  return proposalFor(trip, { id: placement.itemId, type: "activity", title: input.title, category: input.category,
    schedule: input.schedule, ...(place ? { place } : {}) }, placement);
}

/** ID -> trusted resolve -> evidence/retention -> allowlisted snapshot -> validated preview.
 * No writer, no price/availability/booking inference, no provider genre copied into category. */
export async function proposeActivitySelection(trip: Trip, placement: ActivityPlacement,
  request: { candidateId: string; taskId: string; schedule?: ItinerarySchedule },
  port: ActivitySelectionPort, selectedAt: string): Promise<TripUpdateProposal> {
  exactKeys(request, ["candidateId", "taskId", "schedule"]);
  const matches = await port.resolve(request.candidateId);
  if (matches.length !== 1) throw new Error("Activity candidate missing or ambiguous");
  const resolved = matches[0]!;
  const source = resolved.source;
  if (resolved.candidateId !== request.candidateId || resolved.tripId !== trip.id || resolved.taskId !== request.taskId ||
      !validInstant(selectedAt) || !validInstant(resolved.validUntil) || Date.parse(selectedAt) > Date.parse(resolved.validUntil) ||
      !validInstant(source.retrievedAt) || Date.parse(source.retrievedAt) > Date.parse(selectedAt) ||
      source.validFrom !== undefined && (!validInstant(source.validFrom) || Date.parse(source.validFrom) > Date.parse(selectedAt)) ||
      source.validUntil !== undefined && (!validInstant(source.validUntil) || Date.parse(source.validUntil) < Date.parse(selectedAt)) ||
      !resolved.provider || resolved.provider === "manual" || !resolved.providerItemId ||
      source.provider !== resolved.provider || source.sourceId !== resolved.providerItemId || source.confidence !== "observed" ||
      !resolved.retainTitle || resolved.placeRetention.origin !== "provider" || resolved.placeRetention.provider !== resolved.provider ||
      !resolved.place.sources.some((s) => s.id === source.id && s.sourceId === source.sourceId && s.provider === source.provider &&
        s.retrievedAt === source.retrievedAt && s.confidence === source.confidence)) throw new Error("Activity evidence, scope, freshness or retention is invalid");
  let category: ActivityCategory;
  let schedule: ItinerarySchedule = request.schedule ?? { type: "unscheduled" };
  if (resolved.kind === "restaurant") {
    if (resolved.result.providerRestaurantId !== resolved.providerItemId || source.kind !== "restaurant" ||
        resolved.place.ref?.providerPlaceId !== resolved.providerItemId || resolved.place.name !== resolved.result.name) throw new Error("Restaurant identity mismatch");
    category = "food"; // Hot Pepper genre is intentionally not the Domain category.
  } else if (resolved.kind === "experience") {
    if (resolved.result.kind !== "experience" || resolved.result.provider !== resolved.provider || resolved.result.providerItemId !== resolved.providerItemId ||
        !["place", "event", "web"].includes(source.kind)) throw new Error("Experience identity mismatch");
    category = "experience"; // Offering kind, not provider tags. Venue identity comes from resolved Place.
    if (!resolved.retainSchedule && (request.schedule === undefined || request.schedule.type !== "unscheduled")) throw new Error("Experience date retention is unconfirmed");
    if (request.schedule === undefined) {
      schedule = { type: "day", date: resolved.result.startDate };
    } else {
      validateItinerarySchedule(schedule);
      const date = schedule.type === "day" ? schedule.date : schedule.type === "fixed" ? schedule.startAt.at.slice(0, 10) :
        schedule.type === "window" ? schedule.earliestStart.at.slice(0, 10) : undefined;
      if (date !== undefined && date !== resolved.result.startDate) throw new Error("Activity schedule differs from the selected experience date");
    }
  } else throw new Error("Unsupported activity candidate");
  const place = createPlaceSnapshot(resolved.place, resolved.placeRetention);
  return proposalFor(trip, { id: placement.itemId, type: "activity", title: resolved.result.name,
    category, schedule, place }, placement);
}
