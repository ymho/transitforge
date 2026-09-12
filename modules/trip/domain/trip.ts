import type { ExternalSourceEvidence } from "./external-travel-information";
import { exactKeys, validDate, validInstant, projectRailSchedule, type SelectedRailJourney } from "./selected-rail-journey";
import { validatePlaceSnapshot, type PlaceSnapshot } from "./place-snapshot";
import { validateItinerarySchedule, projectStaySchedule, sameZonedInstant, type ItinerarySchedule } from "./itinerary-schedule";
import { validateTripRequest, type TripRequest } from "./trip-request";

/** The single Trip V2 aggregate. Deferred fields are absent, not default-completed. Writer remains gated. */
export interface Trip {
  readonly id: string;
  readonly schemaVersion: 2;
  readonly revision: number;
  readonly title: string;
  readonly request: TripRequest;
  readonly items: readonly ItineraryItem[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ItineraryItemBase { readonly id: string; readonly title: string; readonly schedule: ItinerarySchedule; }
export interface TransportItineraryItem extends ItineraryItemBase {
  readonly type: "transport";
  readonly detail:
    | { readonly status: "unresolved"; readonly mode?: "rail" }
    | { readonly status: "selected"; readonly mode: "rail"; readonly journey: SelectedRailJourney };
}
export interface StayItineraryItem extends ItineraryItemBase {
  readonly type: "stay";
  readonly selection:
    | { readonly status: "unselected"; readonly place?: PlaceSnapshot }
    | { readonly status: "selected"; readonly accommodation: {
      // Minimal slice of #415's final accommodation contract, not another Offering type.
      // #400 adds accommodation identity/observation fields here, #412 owns Money.
      readonly place: PlaceSnapshot;
      readonly selectedAt: string;
      readonly checkInDate: string;
      readonly checkOutDate: string;
      readonly sources: readonly ExternalSourceEvidence[];
    } };
}
export type ItineraryItem = TransportItineraryItem | StayItineraryItem;

/** Minimal candidate-adoption patch. #389 extends this same contract with revisions and other operations. */
export type TripPatch = { readonly type: "replace"; readonly itemId: string; readonly item: ItineraryItem }
  | { readonly type: "request"; readonly request: TripRequest };
export interface TripUpdateProposal {
  readonly tripId: string;
  readonly summary: string;
  readonly patches: readonly TripPatch[];
}

export function createTrip(id: string, title: string, createdAt: string, items: readonly ItineraryItem[] = [], request: TripRequest = { constraints: [], assumptions: [] }): Trip {
  const trip: Trip = { id, title, schemaVersion: 2, revision: 0, createdAt, updatedAt: createdAt, items, request };
  validateTrip(trip);
  return structuredClone(trip);
}

export function validateTrip(trip: Trip): void {
  exactKeys(trip, ["id", "title", "schemaVersion", "revision", "createdAt", "updatedAt", "items", "request"]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(trip.id) ||
      trip.schemaVersion !== 2 || !Number.isSafeInteger(trip.revision) || trip.revision < 0 ||
      typeof trip.title !== "string" || !validInstant(trip.createdAt) || !validInstant(trip.updatedAt) ||
      Date.parse(trip.updatedAt) < Date.parse(trip.createdAt) ||
      new Set(trip.items.map(({ id }) => id)).size !== trip.items.length) throw new Error("Invalid Trip");
  trip.items.forEach(validateItem);
  validateTripRequest(trip.request, trip.items);
}

function validateItem(item: ItineraryItem): void {
  if (!item.id || typeof item.title !== "string") throw new Error("Invalid itinerary identity");
  validateItinerarySchedule(item.schedule);
  if (item.type === "transport") {
    exactKeys(item, ["id", "title", "type", "detail", "schedule"]);
    if (item.detail.status === "selected" && item.detail.mode === "rail") {
      exactKeys(item.detail, ["status", "mode", "journey"]);
      const projected = projectRailSchedule(item.detail.journey);
      if (item.schedule.type !== "fixed" || !item.schedule.endAt ||
          !sameZonedInstant(item.schedule.startAt, projected.startAt) ||
          !sameZonedInstant(item.schedule.endAt, projected.endAt!)) throw new Error("Rail schedule differs from adopted timetable");
    } else if (item.detail.status === "unresolved" && (item.detail.mode === undefined || item.detail.mode === "rail")) {
      exactKeys(item.detail, ["status", "mode"]);
    } else throw new Error("Invalid transport selection");
  } else if (item.type === "stay") {
    exactKeys(item, ["id", "title", "type", "selection", "schedule"]);
    if (item.selection.status === "unselected") {
      exactKeys(item.selection, ["status", "place"]);
      if (item.selection.place !== undefined) validatePlaceSnapshot(item.selection.place);
      return;
    }
    if (item.selection.status !== "selected") throw new Error("Invalid stay selection");
    exactKeys(item.selection, ["status", "accommodation"]);
    const stay = item.selection.accommodation;
    exactKeys(stay, ["place", "selectedAt", "checkInDate", "checkOutDate", "sources"]);
    validatePlaceSnapshot(stay.place);
    const projected = projectStaySchedule(stay.checkInDate, stay.checkOutDate, stay.place.timeZone);
    if (item.schedule.type !== "day" || item.schedule.date !== projected.date ||
        item.schedule.endDate !== projected.endDate || item.schedule.timeZone !== projected.timeZone) throw new Error("Stay schedule differs from adopted stay dates");
    if (!stay.place.name || !validInstant(stay.selectedAt) || !validDate(stay.checkInDate) ||
        !validDate(stay.checkOutDate) || stay.checkInDate >= stay.checkOutDate || !stay.sources.length) throw new Error("Invalid adopted accommodation");
    stay.sources.forEach((source) => {
      exactKeys(source, ["id", "kind", "provider", "sourceId", "retrievedAt", "confidence"]);
      if (!source.id || source.kind !== "accommodation" || !source.provider || !source.sourceId ||
          !validInstant(source.retrievedAt) || source.confidence !== "observed" ||
          Date.parse(source.retrievedAt) > Date.parse(stay.selectedAt)) throw new Error("Invalid accommodation source");
    });
  } else throw new Error("Unsupported itinerary type");
}

/** Pure in-memory proposal application, NOT a production writer/CAS implementation. */
export function applyTripProposal(trip: Trip, proposal: TripUpdateProposal): Trip {
  validateTrip(trip);
  exactKeys(proposal, ["tripId", "summary", "patches"]);
  if (proposal.tripId !== trip.id) throw new Error("Proposal belongs to another Trip");
  const items = [...trip.items];
  let request = trip.request;
  for (const patch of proposal.patches) {
    if (patch.type === "request") {
      exactKeys(patch, ["type", "request"]);
      request = patch.request;
      continue; // Cross-references are validated against the final items, not a partial patch state.
    }
    exactKeys(patch, ["type", "itemId", "item"]);
    const index = items.findIndex(({ id }) => id === patch.itemId);
    if (patch.type !== "replace" || index < 0 || patch.item.id !== patch.itemId) throw new Error("Replacement requires an existing stable item ID");
    validateItem(patch.item);
    if (patch.item.type !== items[index]!.type) throw new Error("Candidate kind differs from target item");
    items[index] = patch.item;
  }
  // Validation completes before returning any change. #389 will own revision/updatedAt mutation.
  const result: Trip = { id: trip.id, schemaVersion: 2, revision: trip.revision, title: trip.title,
    createdAt: trip.createdAt, updatedAt: trip.updatedAt, items, request };
  validateTrip(result);
  return structuredClone(result);
}
