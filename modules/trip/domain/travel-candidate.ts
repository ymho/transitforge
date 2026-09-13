import type { JourneyRouteResult } from "@raiquora/journey/direct-route-search";
import { addMoney, validatePriceObservation, type Money, type PriceObservation } from "./money";

export type TravelCostCategory = "accommodation" | "experience";

export interface TravelOffering {
  provider: string;
  providerItemId: string;
  name: string;
  price?: PriceObservation;
  bookingUrl?: string;
}

/** Volatile comparison result. Price/availability/booking/media are not persisted Trip facts. */
export interface AccommodationOffering extends TravelOffering {
  kind: "accommodation";
  checkInDate: string;
  checkOutDate: string;
  areaName?: string;
  imageUrl?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  reviewAverage?: number;
  reviewCount?: number;
  availability?: "available" | "unknown";
}

export interface ExperienceOffering extends TravelOffering {
  kind: "experience";
  startDate: string;
  areaName?: string;
}

export interface TravelExpenseSummary {
  /** Observed subtotals of supplied offerings, not guaranteed current/final trip cost. */
  totals: readonly Money[];
  pricedItemCount: number;
  hasUnpricedItems: boolean;
  excludesRailFare: true;
}

export interface TravelCandidate {
  id: string;
  /** Comparison result, never an adopted Trip item. Discovery need not have a rail route yet. */
  journey?: JourneyRouteResult;
  accommodations: readonly AccommodationOffering[];
  experiences: readonly ExperienceOffering[];
  expenseSummary: TravelExpenseSummary;
}

export interface TravelCandidateInput {
  id: string;
  journey?: JourneyRouteResult;
  accommodations?: readonly AccommodationOffering[];
  experiences?: readonly ExperienceOffering[];
}

/**
 * 列車経路を正本にして 宿泊と体験を追加した旅行候補を組み立てる。
 * 鉄道運賃は取得も推定もせず 金額合計へ含めない。
 */
export function createTravelCandidate(input: TravelCandidateInput): TravelCandidate {
  const accommodations = input.accommodations ?? [];
  const experiences = input.experiences ?? [];

  return {
    id: input.id,
    journey: input.journey,
    accommodations,
    experiences,
    expenseSummary: travelExpenseSummary(accommodations, experiences),
  };
}

export function travelExpenseSummary(
  accommodations: readonly AccommodationOffering[],
  experiences: readonly ExperienceOffering[],
): TravelExpenseSummary {
  const totals = new Map<string, Money>();
  let pricedItemCount = 0;
  let hasUnpricedItems = false;
  for (const offering of [...accommodations, ...experiences]) {
    if (!offering.price) {
      hasUnpricedItems = true;
      continue;
    }
    validatePriceObservation(offering.price);
    const money = offering.price.price;
    totals.set(money.currency, addMoney(totals.get(money.currency) ?? { currency: money.currency, amountMinor: 0 }, money));
    pricedItemCount += 1;
  }

  return { totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), pricedItemCount, hasUnpricedItems, excludesRailFare: true };
}
