export interface TravelDestination {
  name: string;
  accommodationDestination: string;
  accessStation: string;
  extendedStayDestinations?: string[];
}

const travelDestinations: TravelDestination[] = [
  { name: "出雲大社", accommodationDestination: "出雲", accessStation: "出雲市" },
  { name: "城崎温泉", accommodationDestination: "城崎温泉", accessStation: "城崎温泉" },
  {
    name: "宮島",
    accommodationDestination: "宮島",
    accessStation: "宮島口",
    extendedStayDestinations: ["広島", "倉敷美観地区"],
  },
  { name: "倉敷美観地区", accommodationDestination: "倉敷", accessStation: "倉敷" },
  { name: "奈良公園", accommodationDestination: "奈良", accessStation: "奈良" },
  { name: "大山", accommodationDestination: "米子", accessStation: "米子" },
];

export function travelDestinationAccess(destination: string): TravelDestination | undefined {
  const normalized = normalizeDestination(destination);
  return travelDestinations.find((candidate) => normalized.includes(normalizeDestination(candidate.name)));
}

export function extendedStayDestinations(destination: string): string[] {
  return travelDestinationAccess(destination)?.extendedStayDestinations ?? [];
}

function normalizeDestination(value: string): string {
  return value.normalize("NFKC").replace(/[\s　]+/gu, "");
}
