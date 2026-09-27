export type TravelCompanion = "solo" | "partner" | "friends" | "children" | "family";
export type ChildAgeGroup = "baby" | "preschool" | "elementary" | "teen";
export type TravelPreference =
  | "sea" | "mountain" | "nature" | "onsen" | "food" | "railway"
  | "history" | "cityWalk" | "animals" | "art" | "themePark" | "shopping";

/** Account-level defaults only. Trip-specific dates, party, budget and mobility
 * belong to Trip and must never be inferred from this profile. */
export interface UserProfile {
  version: 3;
  /** Station, neighborhood or area the user normally starts leisure travel from. */
  usualOrigin?: string;
  /** Stable interests used only as soft recommendation hints. */
  interests: TravelPreference[];
  /** Free-text standing preference/constraint. Untrusted data, never executable instructions. */
  considerations?: string;
  updatedAt: string;
}

export interface TripContext {
  planningStage?: "inspiration" | "planning";
  destinationWish?: string;
  startDate?: string;
  endDate?: string;
  stayNights?: number;
  outboundDepartureTimeMinutes?: number;
  returnArrivalTimeMinutes?: number;
  interests?: Partial<Record<TravelPreference, number>>;
  relativeDistancePreference?: "nearer" | "farther";
  avoidances?: string[];
  adventureIntensity?: 0 | 1 | 2 | 3;
  avoidedRisks?: AdventureRisk[];
}
export type AdventureRisk = "illegal" | "uncontrolled-violence" | "unverified-border" | "night-isolation" | "transport-stranding" | "weather-exposure";

export const travelPreferenceLabels: Record<TravelPreference, string> = {
  sea: "海", mountain: "山", nature: "自然", onsen: "温泉", food: "食", railway: "鉄道",
  history: "歴史", cityWalk: "街歩き", animals: "動物", art: "アート", themePark: "テーマパーク", shopping: "買い物",
};

export function travelStyleSummary(profile: UserProfile): string {
  const interests = profile.interests.slice(0, 3).map((key) => travelPreferenceLabels[key]);
  const origin = profile.usualOrigin ? `${profile.usualOrigin}を普段の出発地として、` : "";
  const likes = interests.length ? `${interests.join("・")}を楽しめる旅を参考にします。` : "その旅で伝えられた希望を優先します。";
  return `${origin}${likes}`;
}

export function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  const keys = Object.keys(profile);
  if (keys.some((key) => !["version", "usualOrigin", "interests", "considerations", "updatedAt"].includes(key))) return false;
  return profile.version === 3 &&
    (profile.usualOrigin === undefined || boundedText(profile.usualOrigin, 200)) &&
    Array.isArray(profile.interests) && profile.interests.length <= 12 &&
    new Set(profile.interests).size === profile.interests.length &&
    profile.interests.every((v) => Object.hasOwn(travelPreferenceLabels, String(v))) &&
    (profile.considerations === undefined || boundedText(profile.considerations, 1000)) &&
    typeof profile.updatedAt === "string";
}
function boundedText(value: unknown, maximum: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}
