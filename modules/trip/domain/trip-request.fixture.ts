import { createTrip, type ItineraryItem } from "./trip";
import type { TripRequest, TripConstraint } from "./trip-request";
import { createPlaceSnapshot } from "./place-snapshot";
import { projectRailSchedule, selectRailJourney } from "./selected-rail-journey";
import { railSelectionFixture } from "./selected-rail-journey.fixture";

export const requestAt = { at: "2026-09-13T11:00:00+09:00", timeZone: "Asia/Tokyo" };
export function requestConstraint(requirement: TripConstraint["requirement"], overrides: Partial<TripConstraint> = {}): TripConstraint {
  return { id: "condition", source: "user", strength: "hard", scope: { type: "trip" }, requirement, ...overrides };
}
export function requestTrip(request: TripRequest = { constraints: [], assumptions: [] }, items: readonly ItineraryItem[] = []) {
  return createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-12T08:00:00Z", items, request);
}
export function assumedRequest(source: "model" | "profile" | "legacy" = "model"): TripRequest {
  return {
    constraints: [requestConstraint({ type: "pace", value: 0.3 }, { source: source === "model" ? "assumption" : source, assumptionId: "assumption" })],
    assumptions: [{ id: "assumption", text: "ゆっくり巡ると仮置き", source, status: "unconfirmed", affects: [{ type: "constraint", constraintId: "condition" }] }],
  };
}
export function requestRailItem(): Extract<ItineraryItem, { type: "transport" }> {
  const { candidate, inputs, selectedAt } = railSelectionFixture();
  const journey = selectRailJourney(candidate, inputs, selectedAt);
  return { id: "rail", title: "移動", type: "transport", schedule: projectRailSchedule(journey), detail: { mode: "rail", status: "selected", journey } };
}
export function providerRequestPlace() {
  return createPlaceSnapshot({ ref: { provider: "synthetic", providerPlaceId: "opaque:001" }, name: "駅",
    sources: [{ id: "synthetic-evidence", kind: "place", provider: "synthetic", sourceId: "catalog", confidence: "observed", retrievedAt: "2026-09-12T07:00:00Z" }] },
  { origin: "provider", provider: "synthetic", storage: "permitted", allowedFields: ["ref", "name", "sources"] });
}
