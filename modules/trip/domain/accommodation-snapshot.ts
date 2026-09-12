import type { ExternalSourceEvidence } from "./external-travel-information";
import { validatePlaceSnapshot, validatePlaceSource, type PlaceSnapshot } from "./place-snapshot";
import { validDate, validInstant, exactKeys } from "./snapshot-validation";
import { projectStaySchedule, type LocalDate } from "./itinerary-schedule";

/** Adopted accommodation product, not a search Offering, current availability or Reservation. */
export interface AccommodationSnapshot {
  readonly provider: string;
  readonly providerItemId: string;
  readonly place: PlaceSnapshot;
  readonly selectedAt: string;
  readonly checkInDate: LocalDate;
  readonly checkOutDate: LocalDate;
  readonly sources: readonly ExternalSourceEvidence[];
}

/** Selection-time chronology, never a claim that an observation remains current afterwards. */
export function validateAccommodationSource(source: ExternalSourceEvidence, provider: string, providerItemId: string, selectedAt: string): void {
  validatePlaceSource(source);
  if (!validInstant(selectedAt) || source.kind !== "accommodation" || source.confidence !== "observed" ||
      source.provider !== provider || source.sourceId !== providerItemId ||
      Date.parse(source.retrievedAt) > Date.parse(selectedAt) ||
      source.observedAt !== undefined && Date.parse(source.observedAt) > Date.parse(source.retrievedAt) ||
      source.validFrom !== undefined && Date.parse(source.validFrom) > Date.parse(selectedAt) ||
      source.validUntil !== undefined && Date.parse(source.validUntil) < Date.parse(selectedAt)) {
    throw new Error("Invalid accommodation evidence identity or selection chronology");
  }
}

export function validateAccommodationSnapshot(value: AccommodationSnapshot): void {
  exactKeys(value, ["provider", "providerItemId", "place", "selectedAt", "checkInDate", "checkOutDate", "sources"]);
  if (typeof value.provider !== "string" || !value.provider.trim() || value.provider === "manual" ||
      typeof value.providerItemId !== "string" || !value.providerItemId.trim() || !validInstant(value.selectedAt) ||
      !validDate(value.checkInDate) || !validDate(value.checkOutDate) || value.checkInDate >= value.checkOutDate ||
      !Array.isArray(value.sources) || !value.sources.length) throw new Error("Invalid accommodation snapshot");
  validatePlaceSnapshot(value.place);
  projectStaySchedule(value.checkInDate, value.checkOutDate, value.place.timeZone);
  value.sources.forEach((source) => validateAccommodationSource(source, value.provider, value.providerItemId, value.selectedAt));
  if (value.place.capturedAt !== undefined && Date.parse(value.place.capturedAt) > Date.parse(value.selectedAt) ||
      value.place.sources.some((source) => Date.parse(source.retrievedAt) > Date.parse(value.selectedAt))) {
    throw new Error("Accommodation place is newer than selection");
  }
}
