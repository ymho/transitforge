import type { ExternalSourceEvidence } from "./external-travel-information";
import { exactKeys, validDate, validInstant, projectRailSchedule, type SelectedRailJourney } from "./selected-rail-journey";
import { validatePlaceSnapshot, type PlaceSnapshot } from "./place-snapshot";
import { validateItinerarySchedule, projectStaySchedule, sameZonedInstant, type ItinerarySchedule } from "./itinerary-schedule";
import { validateTripRequest, validatePartyAssumptionTransition, type TripRequest } from "./trip-request";
import { validatePlanningState, validateTripState, type PlanningState, type LifecycleState } from "./trip-state";
import { assessTripTime, type TripClock } from "./trip-temporal";

/** The single Trip V2 aggregate. Deferred fields are absent, not default-completed. Writer remains gated. */
export interface Trip {
  readonly id: string;
  readonly schemaVersion: 2;
  readonly revision: number;
  readonly title: string;
  readonly request: TripRequest;
  readonly planningState: PlanningState;
  readonly lifecycleState: LifecycleState;
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
export const activityCategories = ["sightseeing", "food", "experience", "event", "shopping", "relaxation", "free-time", "other"] as const;
export type ActivityCategory = typeof activityCategories[number];
export interface ActivityItineraryItem extends ItineraryItemBase {
  readonly type: "activity";
  readonly category: ActivityCategory;
  readonly place?: PlaceSnapshot;
}
export type ItineraryItem = TransportItineraryItem | StayItineraryItem | ActivityItineraryItem;

/** Minimal candidate-adoption patch. #389 extends this same contract with revisions and other operations. */
export type TripPatch = { readonly type: "replace"; readonly itemId: string; readonly item: ItineraryItem }
  | { readonly type: "add"; readonly item: ItineraryItem; readonly afterId?: string }
  | { readonly type: "request"; readonly request: TripRequest }
  | { readonly type: "planning"; readonly state: PlanningState }
  | { readonly type: "lifecycle"; readonly state: LifecycleState; readonly basis: "schedule" | "user_confirmation" };
export interface TripUpdateProposal {
  readonly tripId: string;
  readonly summary: string;
  readonly patches: readonly TripPatch[];
}

export function createTrip(id: string, title: string, createdAt: string, items: readonly ItineraryItem[] = [], request: TripRequest = { constraints: [], assumptions: [] }, planningState: PlanningState = "inspiration"): Trip {
  const trip: Trip = { id, title, schemaVersion: 2, revision: 0, createdAt, updatedAt: createdAt, items, request,
    planningState, lifecycleState: "pre_trip" };
  validateTrip(trip);
  return structuredClone(trip);
}

export function validateTrip(trip: Trip): void {
  exactKeys(trip, ["id", "title", "schemaVersion", "revision", "createdAt", "updatedAt", "items", "request", "planningState", "lifecycleState"]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(trip.id) ||
      trip.schemaVersion !== 2 || !Number.isSafeInteger(trip.revision) || trip.revision < 0 ||
      typeof trip.title !== "string" || !validInstant(trip.createdAt) || !validInstant(trip.updatedAt) ||
      Date.parse(trip.updatedAt) < Date.parse(trip.createdAt) ||
      new Set(trip.items.map(({ id }) => id)).size !== trip.items.length) throw new Error("Invalid Trip");
  trip.items.forEach(validateItem);
  validateTripRequest(trip.request, trip.items);
  validateTripState(trip);
}

function validateItem(item: ItineraryItem): void {
  if (typeof item.id !== "string" || !item.id.trim() || typeof item.title !== "string") throw new Error("Invalid itinerary identity");
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
  } else if (item.type === "activity") {
    exactKeys(item, ["id", "title", "type", "category", "place", "schedule"]);
    if (!item.title.trim() || !activityCategories.includes(item.category)) throw new Error("Invalid activity");
    if (item.place !== undefined) validatePlaceSnapshot(item.place);
  } else throw new Error("Unsupported itinerary type");
}

/** Pure in-memory proposal application, NOT a production writer/CAS implementation. */
export function applyTripProposal(trip: Trip, proposal: TripUpdateProposal,
  authority: { clock?: TripClock; confirmedLifecycle?: LifecycleState } = {}): Trip {
  validateTrip(trip);
  exactKeys(proposal, ["tripId", "summary", "patches"]);
  if (proposal.tripId !== trip.id) throw new Error("Proposal belongs to another Trip");
  const items = [...trip.items];
  let request = trip.request;
  let planningState = trip.planningState;
  let lifecyclePatch: Extract<TripPatch, { type: "lifecycle" }> | undefined;
  for (const patch of proposal.patches) {
    if (patch.type === "add") {
      exactKeys(patch, ["type", "item", "afterId"]);
      validateItem(patch.item);
      if (items.some(({ id }) => id === patch.item.id)) throw new Error("Duplicate itinerary item ID");
      const after = patch.afterId === undefined ? items.length - 1 : items.findIndex(({ id }) => id === patch.afterId);
      if (patch.afterId !== undefined && (typeof patch.afterId !== "string" || !patch.afterId.trim() || after < 0)) throw new Error("Unknown insertion reference");
      items.splice(after + 1, 0, patch.item);
      continue;
    }
    if (patch.type === "planning") {
      exactKeys(patch, ["type", "state"]);
      validatePlanningState(patch.state);
      planningState = patch.state;
      continue;
    }
    if (patch.type === "lifecycle") {
      exactKeys(patch, ["type", "state", "basis"]);
      if (lifecyclePatch) throw new Error("Only one lifecycle decision per proposal");
      if (patch.basis !== "schedule" && patch.basis !== "user_confirmation") throw new Error("Lifecycle basis required");
      if ((trip.lifecycleState === "cancelled" || trip.lifecycleState === "completed") && patch.state !== trip.lifecycleState) {
        throw new Error("Terminal lifecycle cannot be revived");
      }
      lifecyclePatch = patch;
      continue;
    }
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
    createdAt: trip.createdAt, updatedAt: trip.updatedAt, items, request, planningState,
    lifecycleState: lifecyclePatch?.state ?? trip.lifecycleState };
  validateTrip(result);
  validatePartyAssumptionTransition(trip.request, result.request);
  // Confirmation is supplied separately by Application, never trusted from a model's patch body.
  if (lifecyclePatch?.basis === "user_confirmation" && authority.confirmedLifecycle !== lifecyclePatch.state) {
    throw new Error("Explicit user lifecycle confirmation required");
  }
  if (lifecyclePatch?.basis === "schedule") {
    if (!authority.clock || assessTripTime({ items, lifecycleState: trip.lifecycleState }, authority.clock).suggestedLifecycle !== lifecyclePatch.state) {
      throw new Error("Adopted schedules and real-time Clock do not support lifecycle transition");
    }
  }
  return structuredClone(result);
}
