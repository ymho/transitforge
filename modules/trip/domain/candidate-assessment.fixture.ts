import { createTrip } from "./trip";
import { createTravelCandidate } from "./travel-candidate";
import { resolvedPlace, placesTripId, placesAt } from "./trip-places.fixture";
import type { CandidateAssessmentFacts } from "./travel-candidate-assessment";
import type { ExternalSourceEvidence, ExternalTravelInformation } from "./external-travel-information";
import type { WeatherForecast } from "./weather-forecast";

/** Public synthetic facts, never live provider data. */
export const assessmentAt = "2026-09-12T08:00:00Z";
export function assessmentSource(id: string, kind: ExternalSourceEvidence["kind"], provider = "fixture", sourceId = id): ExternalSourceEvidence {
  return { id, kind, provider, sourceId, retrievedAt: "2026-09-12T07:55:00Z", validUntil: "2026-09-13T08:00:00Z",
    confidence: kind === "weather" ? "provider-forecast" : "observed" };
}
export function assessedInformation<T>(data: T, evidence: readonly ExternalSourceEvidence[]): ExternalTravelInformation<T> {
  return { status: "available", freshness: "fresh", data, evidence: [...evidence] };
}
export function forecastFixture(probability = 10): WeatherForecast {
  return { locationName: "Synthetic Vienna", latitude: 48.2, longitude: 16.3, timezone: "Europe/Vienna", hourly: [], alertsAvailable: false,
    daily: [{ date: "2026-09-13", minimumTemperatureCelsius: 15, maximumTemperatureCelsius: 25,
      maximumPrecipitationProbabilityPercent: probability, precipitationMillimeters: probability >= 70 ? 20 : 0,
      weatherCode: probability >= 70 ? 63 : 1 }] };
}
export function candidateAssessmentFixture(id = "candidate-a") {
  const destination = resolvedPlace("Vienna", "city-vienna");
  const trip = createTrip(placesTripId, "比較", placesAt, [], { constraints: [{ id: "region", strength: "hard", source: "user", scope: { type: "trip" },
    requirement: { type: "destinations", places: [destination], order: "flexible" } }], assumptions: [] });
  const candidate = createTravelCandidate({ id, accommodations: [{ kind: "accommodation", provider: "fixture", providerItemId: "hotel-a", name: "Synthetic hotel",
    checkInDate: "2026-09-13", checkOutDate: "2026-09-14", price: { price: { currency: "EUR", amountMinor: 12000 }, observedAt: "2026-09-12T07:54:00Z", basis: "selected-dates" } }] });
  const facts: CandidateAssessmentFacts = { candidateId: id,
    places: assessedInformation({ destinations: [destination], complete: true }, destination.sources),
    weather: { target: { place: destination.ref!, startDate: "2026-09-13", endDate: "2026-09-13" },
      result: assessedInformation(forecastFixture(), [assessmentSource(`weather-${id}`, "weather")]) },
    prices: assessedInformation({ items: [{ provider: "fixture", providerItemId: "hotel-a", observation: candidate.accommodations[0]!.price! }], coverage: "complete", basis: "trip" },
      [assessmentSource("hotel-price", "accommodation", "fixture", "hotel-a")]) };
  return { trip, candidate, facts, destination };
}
