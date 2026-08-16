import type {
  JourneyRouteLeg,
  JourneyRouteResult,
} from "./direct-route-search";
import type { TransferPace } from "./journey-search-preferences";

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
  if (
    current === undefined ||
    finalCurrent === undefined ||
    normalizedStation(current.originStation) !== normalizedStation(alternative.originStation) ||
    normalizedStation(finalCurrent.destinationStation) !== normalizedStation(alternative.destinationStation)
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

function normalizedStation(value: string): string {
  return value.normalize("NFKC").replace(/駅$/u, "").replace(/\s+/gu, "").toLowerCase();
}
