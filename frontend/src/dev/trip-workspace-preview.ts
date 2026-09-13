import { createTrip, applyTripProposal, type Trip, type ItineraryItem } from "@raiquora/trip/trip";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";
import { assessTravelCandidate } from "@raiquora/trip/assess-travel-candidate";
import type { TripWorkspaceSource } from "../usecases/trip-plan/trip-workspace-controller";
import { reservationStatuses, type ReservationFact } from "@raiquora/trip/reservation";

/** Synthetic UI data, DEV-only. Not a current forecast, actual offering, migration or persistent Trip. */
export function tripWorkspacePreviewSource(): TripWorkspaceSource {
  const at = "2026-09-12T08:00:00Z";
  const items: ItineraryItem[] = [
    { id: "air", title: "ウィーンへの移動", type: "transport", schedule: { type: "day", date: "2026-09-21" },
      detail: { status: "selected", mode: "air", origin: { name: "出発空港", sources: [] }, destination: { name: "ウィーン", sources: [] }, provenance: { type: "manual" } } },
    { id: "walk", title: "街をゆっくり歩く", type: "activity", category: "sightseeing", place: { name: "ウィーン", sources: [] },
      schedule: { type: "window", earliestStart: { at: "2026-09-22T14:00:00+02:00", timeZone: "Europe/Vienna" },
        latestEnd: { at: "2026-09-22T18:00:00+02:00", timeZone: "Europe/Vienna" }, durationMinutes: 90 } },
    { id: "hotel", title: "宿泊", type: "stay", schedule: { type: "day", date: "2026-09-22", endDate: "2026-09-24" },
      selection: { status: "selected", accommodation: { provider: "preview", providerItemId: "hotel", selectedAt: at,
        place: { name: "サンプルの宿（実在の提供情報ではありません）", area: "ウィーン", sources: [] },
        checkInDate: "2026-09-22", checkOutDate: "2026-09-24",
        sources: [{ id: "hotel-source", kind: "accommodation", provider: "preview", sourceId: "hotel", retrievedAt: at, confidence: "observed" }],
        observedPrice: { price: { currency: "EUR", amountMinor: 12000 }, observedAt: at, basis: "selected-dates" } } } },
    { id: "taxi", title: "駅への移動", type: "transport", schedule: { type: "unscheduled" }, detail: { mode: "taxi", status: "unresolved" } },
    { id: "free", title: "ザルツブルクで自由時間", type: "activity", category: "free-time", place: { name: "ザルツブルク", sources: [] }, schedule: { type: "unscheduled" } },
  ];
  let trip: Trip = createTrip("39000000-0000-4000-8000-000000000001", "周遊のたたき台（サンプル）", at, items, {
    constraints: [], party: { adults: 2, children: [{}], source: "user" }, assumptions: [
      { id: "afternoon", text: "午後の90分を街歩きに使う", status: "unconfirmed", source: "model", affects: [{ type: "item", itemId: "walk", field: "schedule" }] },
    ],
  }, "itinerary_refinement", "ウィーン・ザルツブルク");
  const candidate = createTravelCandidate({ id: "preview-candidate" });
  const reservations: ReservationFact[] = items.map((item, index) => ({ reservationId: `39800000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    revision: 0, itineraryItemId: item.id, kind: item.type === "stay" ? "accommodation" : item.type,
    status: reservationStatuses[index]! }));
  return { getCurrentTrip: () => trip,
    getReservationFacts: () => reservations,
    getCandidates: () => [{ candidate, assessment: assessTravelCandidate(trip, candidate, { candidateId: candidate.id }, at) }],
    confirmProposal: async (proposal) => { trip = applyTripProposal(trip, proposal); },
  };
}
