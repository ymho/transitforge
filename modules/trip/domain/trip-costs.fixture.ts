import type { TripCostForecast } from "./trip-costs";
import { costCategories } from "./trip-costs";
export const costTripId = "11111111-1111-4111-8111-111111111111";
export function costForecast(tripId = costTripId, baseRevision = 0, amountMinor = 10000): TripCostForecast {
  return { tripId, baseRevision, generatedAt: "2026-09-21T00:00:00Z", items: costCategories.map(category => ({ category,
    amount: { currency: "JPY", amountMinor }, explanation: "旅行全体の概算", assumptions: ["2名・1泊と仮定"] })) };
}
