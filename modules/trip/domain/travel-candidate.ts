import type { JourneyRouteResult } from "@raiquora/journey/direct-route-search";

export type TravelCostCategory = "accommodation" | "experience";

export interface TravelPrice {
  amount: number;
  currency: "JPY";
}

export interface TravelOffering {
  provider: string;
  providerItemId: string;
  name: string;
  price?: TravelPrice;
  bookingUrl?: string;
}

export interface AccommodationOffering extends TravelOffering {
  kind: "accommodation";
  checkInDate: string;
  checkOutDate: string;
  areaName?: string;
}

export interface ExperienceOffering extends TravelOffering {
  kind: "experience";
  startDate: string;
  areaName?: string;
}

export interface TravelExpenseSummary {
  currency: "JPY";
  accommodationAmount: number;
  experienceAmount: number;
  knownTotalAmount: number;
  pricedItemCount: number;
  hasUnpricedItems: boolean;
  excludesRailFare: true;
}

export interface TravelCandidate {
  id: string;
  journey: JourneyRouteResult;
  accommodations: readonly AccommodationOffering[];
  experiences: readonly ExperienceOffering[];
  expenseSummary: TravelExpenseSummary;
}

export interface TravelCandidateInput {
  id: string;
  journey: JourneyRouteResult;
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
  const accommodation = summarizeOfferings(accommodations);
  const experience = summarizeOfferings(experiences);

  return {
    currency: "JPY",
    accommodationAmount: accommodation.amount,
    experienceAmount: experience.amount,
    knownTotalAmount: accommodation.amount + experience.amount,
    pricedItemCount: accommodation.pricedItemCount + experience.pricedItemCount,
    hasUnpricedItems: accommodation.hasUnpricedItems || experience.hasUnpricedItems,
    excludesRailFare: true,
  };
}

function summarizeOfferings(offerings: readonly TravelOffering[]): {
  amount: number;
  pricedItemCount: number;
  hasUnpricedItems: boolean;
} {
  let amount = 0;
  let pricedItemCount = 0;
  let hasUnpricedItems = false;

  for (const offering of offerings) {
    if (!offering.price) {
      hasUnpricedItems = true;
      continue;
    }
    if (!Number.isSafeInteger(offering.price.amount) || offering.price.amount < 0) {
      throw new Error("旅行費用は0以上の整数円で指定してください。");
    }
    amount += offering.price.amount;
    pricedItemCount += 1;
  }

  return { amount, pricedItemCount, hasUnpricedItems };
}
