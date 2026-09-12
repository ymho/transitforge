import type { ViewerAgentResponse } from "../../domain/viewer-agent-response";
import type { Evidence } from "./evidence-model";
import { observeAgentTurn, type AskOnlyException, type VisibleProgress } from "./agent-turn-outcome";

/** Count only the artifacts delivered by the presenter, not Tool execution or state transitions. */
export function observeViewerTurn(response: ViewerAgentResponse, evidence: Evidence[], exception?: AskOnlyException, asksUser = false) {
  const progress: VisibleProgress[] = [];
  if (typeof response !== "string") {
    if ("journeyPlan" in response && response.journeyPlan.journeys.length) progress.push({ kind: "comparison", refs: ["journeyPlan"] });
    if ("travelPlan" in response) progress.push({ kind: "itinerary", refs: ["travelPlan"] });
    if ("tripPlanUpdate" in response && response.tripPlanUpdate.patches.length) progress.push({ kind: "trip_proposal", refs: ["tripPlanUpdate"] });
    if ("tripUpdateProposal" in response && response.tripUpdateProposal.patches.some((p) => p.type === "replace")) {
      progress.push({ kind: "trip_proposal", refs: response.tripUpdateProposal.patches.flatMap((p) => p.type === "replace" ? [p.itemId] : []) });
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
        progress.push({ kind: "candidates", refs: places.data.places.map((p) => p.providerPlaceId) });
      }
      const restaurants = response.external.restaurants;
      if (restaurants?.status === "available" && restaurants.evidence.length && restaurants.data?.restaurants.length) {
        progress.push({ kind: "candidates", refs: restaurants.data.restaurants.map((r) => r.providerRestaurantId) });
      }
    }
  }
  return observeAgentTurn(asksUser || typeof response !== "string" && "conversation" in response && Boolean(response.conversation.question), progress, exception);
}
