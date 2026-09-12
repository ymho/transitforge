import type { Trip } from "@raiquora/trip/trip";
import { validateTrip } from "@raiquora/trip/trip";

/** UI renders text (not HTML) and forwards the selected action to proposeAssumptionDecision. */
export function planAssumptionViews(trip: Trip) {
  validateTrip(trip);
  return trip.request.assumptions.map((a) => ({
    id: a.id, source: a.source, status: a.status,
    text: `${a.status === "unconfirmed" ? "⚠ 仮置き" : a.status === "confirmed" ? "確認済み" : "却下済み"}: ${a.text}`,
    actions: a.status === "unconfirmed" ? [
      ...(!a.affects.some((ref) => ref.type === "party") || trip.request.party?.assumptionId === a.id
        ? [{ assumptionId: a.id, status: "confirmed" as const, label: "この前提で進める" }] : []),
      { assumptionId: a.id, status: "rejected" as const, label: "この前提を使わない" },
    ] : [],
  }));
}
