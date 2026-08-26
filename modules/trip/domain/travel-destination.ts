import type { TravelPreference, UserProfile } from "./travel-profile";

export interface TravelDestination {
  name: string;
  accommodationDestination: string;
  accessStation: string;
  interests: TravelPreference[];
}

const travelDestinations: TravelDestination[] = [
  { name: "出雲大社", accommodationDestination: "出雲", accessStation: "出雲市", interests: ["history", "nature"] },
  { name: "城崎温泉", accommodationDestination: "城崎温泉", accessStation: "城崎温泉", interests: ["onsen", "food"] },
  { name: "宮島", accommodationDestination: "宮島", accessStation: "宮島口", interests: ["history", "sea", "nature"] },
  { name: "倉敷美観地区", accommodationDestination: "倉敷", accessStation: "倉敷", interests: ["history", "cityWalk", "art"] },
  { name: "奈良公園", accommodationDestination: "奈良", accessStation: "奈良", interests: ["history", "animals", "nature"] },
  { name: "大山", accommodationDestination: "米子", accessStation: "米子", interests: ["mountain", "nature"] },
];

export function recommendedTravelDestinations(profile?: UserProfile, limit = 3): TravelDestination[] {
  return travelDestinations
    .map((destination, index) => ({
      destination,
      index,
      score: Math.max(...destination.interests.map(
        (interest) => profile?.preferences[interest] ?? 0.3,
      )),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ destination }) => destination);
}

export function travelDestinationAccess(destination: string): TravelDestination | undefined {
  const normalized = normalizeDestination(destination);
  return travelDestinations.find((candidate) => normalized.includes(normalizeDestination(candidate.name)));
}

function normalizeDestination(value: string): string {
  return value.normalize("NFKC").replace(/[\s　]+/gu, "");
}
