import type { CandidateAssessmentFacts, TravelCandidateAssessment } from "./travel-candidate-assessment";
import { samePlaceIdentity, validatePlaceRef, type PlaceSnapshot } from "./place-snapshot";
import { validDate } from "./snapshot-validation";
import type { CandidateFactReader } from "./candidate-assessment-input";
import { validateTimeZone } from "./itinerary-schedule";
import { validateHazardAlertSearchResult } from "./hazard-alert";

/** Weather thresholds are a transparent comparison indicator, never a forecast or safety verdict. */
export function assessCandidateEnvironment(facts: CandidateAssessmentFacts, places: readonly PlaceSnapshot[], reader: CandidateFactReader,
  expectedDates: readonly { startDate: string; endDate?: string }[] = []):
  Pick<TravelCandidateAssessment, "weather" | "hazard"> {
  const weather: TravelCandidateAssessment["weather"] = { status: "unknown", reasonCodes: ["missing-facts"], evidenceIds: [] };
  const hazard: TravelCandidateAssessment["hazard"] = { status: "unknown", reasonCodes: ["hazard-coverage-unknown"], evidenceIds: [] };
  const w = facts.weather;
  if (w) {
    try {
      validatePlaceRef(w.target.place);
      if (!validDate(w.target.startDate) || !validDate(w.target.endDate) || w.target.endDate < w.target.startDate) throw new Error("Invalid weather dates");
      weather.target = { place: structuredClone(w.target.place), startDate: w.target.startDate, endDate: w.target.endDate };
      const read = reader.read("weather", w.result, ["weather"], (data) => {
        validateTimeZone(data.timezone);
        if (!Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180 || !Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90) throw new Error("Invalid forecast coordinates");
        if (!Array.isArray(data.daily) || new Set(data.daily.map((day) => day.date)).size !== data.daily.length) throw new Error("Invalid forecast");
        for (const day of data.daily) {
          if (!validDate(day.date) || !Number.isFinite(day.maximumPrecipitationProbabilityPercent) || day.maximumPrecipitationProbabilityPercent < 0 ||
              day.maximumPrecipitationProbabilityPercent > 100 || !Number.isFinite(day.precipitationMillimeters) || day.precipitationMillimeters < 0 ||
              !Number.isInteger(day.weatherCode)) throw new Error("Invalid forecast fact");
        }
      }, true);
      weather.evidenceIds = read.evidenceIds;
      if (read.unavailable) { weather.status = "unavailable"; weather.reasonCodes = ["api-unavailable"]; }
      else if (read.reason) weather.reasonCodes = [read.reason];
      else if (!places.some((place) => samePlaceIdentity(place.ref, w.target.place))) weather.reasonCodes = ["identity-unresolved"];
      else if (expectedDates.some((dates) => w.target.startDate !== dates.startDate || w.target.endDate !== (dates.endDate ?? dates.startDate))) weather.reasonCodes = ["forecast-range-out"];
      else {
        const days = read.data!.daily.filter((day) => day.date >= w.target.startDate && day.date <= w.target.endDate);
        const expected = (Date.parse(w.target.endDate) - Date.parse(w.target.startDate)) / 86_400_000 + 1;
        if (days.length !== expected) weather.reasonCodes = ["forecast-range-out"];
        else if (days.some((day) => ![0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(day.weatherCode))) weather.reasonCodes = ["invalid-facts"];
        else {
          const poor = days.some((day) => day.maximumPrecipitationProbabilityPercent >= 70 || day.precipitationMillimeters >= 10 || day.weatherCode >= 95);
          const favorable = days.every((day) => day.maximumPrecipitationProbabilityPercent < 30 && day.precipitationMillimeters < 1 && day.weatherCode <= 3);
          weather.status = poor ? "poor" : favorable ? "favorable" : "mixed";
          weather.reasonCodes = [poor ? "weather-poor" : favorable ? "verified-match" : "weather-mixed"];
        }
      }
    } catch { weather.reasonCodes = ["invalid-facts"]; }
  }
  const h = facts.hazard;
  if (h) {
    try {
      validatePlaceRef(h.place);
      const read = reader.read("hazard", h.result, ["safety-alert"], (data) => {
        validateHazardAlertSearchResult(data);
        for (const alert of data.alerts) {
          if (Date.parse(alert.issuedAt) > Date.parse(reader.now)) throw new Error("Future hazard observation");
        }
      }, true);
      hazard.evidenceIds = read.evidenceIds;
      if (read.unavailable) { hazard.status = "unavailable"; hazard.reasonCodes = ["api-unavailable"]; }
      else if (read.reason) hazard.reasonCodes = [read.reason];
      else if (!places.some((place) => samePlaceIdentity(place.ref, h.place))) hazard.reasonCodes = ["identity-unresolved"];
      else if (read.data!.alerts.length) { hazard.status = "present"; hazard.reasonCodes = ["hazard-present"]; }
      // Empty JMA feeds do not establish exhaustive hazard absence or geographic coverage.
    } catch { hazard.reasonCodes = ["invalid-facts"]; }
  }
  return { weather, hazard };
}
