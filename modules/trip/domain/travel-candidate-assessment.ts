import type { ExternalSourceEvidence, ExternalTravelInformation } from "./external-travel-information";
import type { GroundAccessRoute } from "./ground-access";
import type { Money, PriceObservation } from "./money";
import type { PlaceRef, PlaceSnapshot } from "./place-snapshot";
import type { RailTimetableInput, VerifiedRailCandidate } from "./selected-rail-journey";
import type { TransportMode } from "./transport-detail";
import type { TravelAlertSearchResult } from "./travel-alert";
import type { WeatherForecast } from "./weather-forecast";

export type ConstraintStatus = "satisfied" | "violated" | "unknown";
export const candidateReasonCodes = ["verified-match", "verified-mismatch", "missing-facts", "unconfirmed-assumption",
  "unsupported-requirement", "partial-coverage", "identity-unresolved", "identity-mismatch", "forecast-range-out",
  "api-unavailable", "stale-facts", "freshness-unknown", "invalid-facts", "hazard-present", "hazard-coverage-unknown",
  "mixed-currency", "unpriced-items", "budget-basis-unknown", "subjective-preference", "weather-poor", "weather-mixed"] as const;
export type CandidateReasonCode = typeof candidateReasonCodes[number];
export interface CandidateConstraintAssessment {
  constraintId: string; status: ConstraintStatus; reasonCodes: CandidateReasonCode[]; evidenceIds: string[];
}
export interface CandidatePreferenceAssessment {
  constraintId: string; status: "fit" | "conflict" | "unknown"; reasonCodes: CandidateReasonCode[]; evidenceIds: string[];
}
export interface CandidateFreshnessAssessment {
  evidenceId: string; status: "fresh" | "stale" | "unknown" | "unavailable";
  retrievedAt: string; observedAt?: string; validUntil?: string;
}
export interface CandidateWeatherAssessment {
  status: "favorable" | "mixed" | "poor" | "unknown" | "unavailable";
  target?: { place: PlaceRef; startDate: string; endDate: string };
  reasonCodes: CandidateReasonCode[]; evidenceIds: string[];
}
export interface CandidateHazardAssessment {
  status: "present" | "unknown" | "unavailable";
  reasonCodes: CandidateReasonCode[]; evidenceIds: string[];
}
export interface CandidatePriceAssessment {
  status: "known" | "partial" | "unknown";
  observations: PriceObservation[]; subtotals: Money[];
  comparability: "same-currency" | "mixed-currency" | "unknown";
  coverage: "complete" | "partial"; basis?: "trip" | "per-person";
  unpricedItemCount: number; reasonCodes: CandidateReasonCode[]; evidenceIds: string[];
}
/** Derived, task-local view. Not a Trip field, persisted record, ranking score or model assertion. */
export interface TravelCandidateAssessment {
  candidateId: string; assessedAt: string; constraintStatus: ConstraintStatus;
  hardConstraints: CandidateConstraintAssessment[]; softPreferences: CandidatePreferenceAssessment[];
  relevance: { status: "fit" | "questionable" | "unknown"; reasonCodes: CandidateReasonCode[]; evidenceIds: string[] };
  mobility: { status: "known" | "partial" | "unknown"; travelMinutes?: number; transfers?: number;
    modes?: TransportMode[]; evidenceIds: string[] };
  weather: CandidateWeatherAssessment; hazard: CandidateHazardAssessment; price: CandidatePriceAssessment;
  party: { status: ConstraintStatus; reasonCodes: CandidateReasonCode[]; evidenceIds: string[] };
  freshness: CandidateFreshnessAssessment[];
  sources: ExternalSourceEvidence[];
  partial: boolean;
  caveats: { category: "constraints" | "places" | "mobility" | "weather" | "hazard" | "price" | "party";
    code: CandidateReasonCode }[];
}

/** Trusted, already acquired inputs to a pure calculation. Never accepted as model Tool arguments.
 * Place bindings belong to the existing resolver (#377), not string matching in the assessor.
 * Weather/alerts are the existing external contracts; no parallel Hazard or Evidence aggregate.
 */
export interface CandidateAssessmentFacts {
  candidateId: string;
  places?: ExternalTravelInformation<{ origin?: PlaceSnapshot; destinations: PlaceSnapshot[]; complete: boolean }>;
  dates?: ExternalTravelInformation<{ startDate: string; endDate?: string }>;
  rail?: { candidate: VerifiedRailCandidate; inputs: readonly RailTimetableInput[] };
  groundAccess?: ExternalTravelInformation<GroundAccessRoute>;
  weather?: { target: { place: PlaceRef; startDate: string; endDate: string }; result: ExternalTravelInformation<WeatherForecast> };
  hazard?: { place: PlaceRef; result: ExternalTravelInformation<TravelAlertSearchResult> };
  prices?: ExternalTravelInformation<{
    items: { provider: string; providerItemId: string; observation: PriceObservation }[];
    /** Complete for this candidate/scope only, never a proof of whole-Trip feasibility. */
    coverage: "complete" | "partial"; basis?: "trip" | "per-person";
  }>;
  party?: ExternalTravelInformation<{ adults: number; childAges: (number | null)[]; supported: boolean }>;
}
