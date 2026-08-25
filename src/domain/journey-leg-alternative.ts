import type {
  JourneyRouteLeg,
  JourneyRouteResult,
} from "./direct-route-search";
import type { TransferPace } from "./journey-search-preferences";
import { normalizeStationName } from "./station-name";

const minimumTransferMinutes: Record<TransferPace, number> = {
  hurried: 3.5,
  standard: 5,
  relaxed: 10,
};

export function journeyLegAlternativeFits(
  journey: JourneyRouteResult,
  legIndex: number,
  alternative: JourneyRouteLeg,
  transferPace: TransferPace = "standard",
  endLegIndex = legIndex,
): boolean {
  const current = journey.legs[legIndex];
  const finalCurrent = journey.legs[endLegIndex];
  const originMatches = current &&
    normalizeStationName(current.originStation).toLowerCase() ===
      normalizeStationName(alternative.originStation).toLowerCase();
  const destinationMatches = finalCurrent &&
    normalizeStationName(finalCurrent.destinationStation).toLowerCase() ===
      normalizeStationName(alternative.destinationStation).toLowerCase();
  if (
    current === undefined ||
    finalCurrent === undefined ||
    !originMatches ||
    !destinationMatches
  ) {
    return false;
  }

  const transfer = minimumTransferMinutes[transferPace];
  const previous = journey.legs[legIndex - 1];
  if (previous && alternative.departureTimeMinutes < previous.arrivalTimeMinutes + transfer) {
    return false;
  }
  const next = journey.legs[endLegIndex + 1];
  return !next || alternative.arrivalTimeMinutes + transfer <= next.departureTimeMinutes;
}
