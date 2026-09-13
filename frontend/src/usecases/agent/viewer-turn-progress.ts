import type { ViewerAgentResponse } from "../../domain/viewer-agent-response";
import type { Evidence } from "./evidence-model";
import { observeAgentTurn, type AskOnlyException, type VisibleProgress } from "./agent-turn-outcome";
import type { TripJourneyPlan } from "@raiquora/trip/travel-plan";
import type { TripPlanItem } from "@raiquora/trip/trip-plan";

/** Count only the artifacts delivered by the presenter, not Tool execution or state transitions. */
export function observeViewerTurn(response: ViewerAgentResponse, evidence: Evidence[], exception?: AskOnlyException, asksUser = false) {
  const progress: VisibleProgress[] = [];
  if (typeof response !== "string") {
    if ("checklistProposal" in response && response.checklistProposal.suggestions.length) {
      progress.push({ kind: "checklist_proposal", refs: [response.checklistProposal.tripId] });
    }
    if ("journeyPlan" in response && concreteJourney(response.journeyPlan)) {
      progress.push({ kind: "comparison", refs: ["journeyPlan"] }, { kind: "candidates", refs: ["journeyPlan"] });
    }
    if ("travelPlan" in response && response.travelPlan.checkInDate &&
        response.travelPlan.checkOutDate &&
        (concreteJourney(response.travelPlan.outbound) || concreteJourney(response.travelPlan.returning))) {
      progress.push({ kind: "itinerary", refs: ["travelPlan"] });
    }
    if ("tripPlanUpdate" in response) {
      const refs = response.tripPlanUpdate.patches.flatMap((p) =>
        (p.type === "add" || p.type === "replace") && concreteLegacyItem(p.item) ? [p.item.id] : []);
      const editRefs = response.tripPlanUpdate.patches.flatMap((p) => p.type === "remove" || p.type === "move" ? [p.itemId] : []);
      if (refs.length || editRefs.length) progress.push({ kind: "trip_proposal", refs: [...refs, ...editRefs] });
      if (refs.length) progress.push({ kind: "itinerary", refs });
    }
    if ("tripUpdateProposal" in response) {
      const refs = response.tripUpdateProposal.patches.flatMap((p) => (p.type === "replace" || p.type === "add") && p.item.id &&
        (p.item.type === "transport" ? p.item.detail.status === "selected" && (p.item.detail.mode === "rail" ? p.item.detail.journey.legs.length > 0 :
          Boolean(p.item.detail.origin.name.trim() && p.item.detail.destination.name.trim())) :
          p.item.type === "activity" ? Boolean(p.item.title.trim()) :
          p.item.selection.status === "selected" && Boolean(p.item.selection.accommodation.place.name)) ? [p.item.id] : []);
      if (refs.length) progress.push({ kind: "trip_proposal", refs }, { kind: "itinerary", refs });
    }
    if ("progressSources" in response && response.progressSources?.length) {
      const ids = response.progressSources.map((s) => s.evidenceId);
      if (ids.every((id) => evidence.some((e) => e.id === id && e.references.length > 0 && e.knowledgeKind !== "unverified_information"))) {
        progress.push({ kind: "grounded_decision", refs: ids });
      }
    }
    if ("external" in response && response.external) {
      const places = response.external.places;
      if (places?.status === "available" && places.evidence.length && places.data?.places.length) {
        progress.push({ kind: "candidates", refs: places.data.places.filter((p) => p.name.trim()).map((p) => p.providerPlaceId) });
      }
      const restaurants = response.external.restaurants;
      if (restaurants?.status === "available" && restaurants.evidence.length && restaurants.data?.restaurants.length) {
        progress.push({ kind: "candidates", refs: restaurants.data.restaurants.filter((r) => r.name.trim()).map((r) => r.providerRestaurantId) });
      }
    }
  }
  return observeAgentTurn(asksUser || typeof response !== "string" && "conversation" in response && Boolean(response.conversation.question), progress, exception);
}

function concreteJourney(plan: TripJourneyPlan): boolean {
  return Boolean(plan.originStation && plan.destinationStation && plan.journeys.some((j) =>
    j.legs.length > 0 && Number.isFinite(j.departureTimeMinutes) && Number.isFinite(j.arrivalTimeMinutes)));
}

function concreteLegacyItem(item: TripPlanItem): boolean {
  if (!item.id) return false;
  if (item.type === "movement") return item.mode === "rail" ?
    Boolean(item.route.departureDate || item.route.serviceDate) && concreteJourney(item.route) :
    Boolean(item.date && item.origin && item.destination);
  if (item.type === "stay") return Boolean(item.checkInDate && item.checkOutDate && (item.accommodation?.name || item.destination));
  return Boolean(item.place.name && item.date);
}
