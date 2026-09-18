export type TravelCompanion = "solo" | "partner" | "friends" | "children" | "family";
export type ChildAgeGroup = "baby" | "preschool" | "elementary" | "teen";
export type TravelPreference =
  | "sea" | "mountain" | "nature" | "onsen" | "food" | "railway"
  | "history" | "cityWalk" | "animals" | "art" | "themePark" | "shopping";

export interface UserProfile {
  version: 2;
  home: { station?: string; area?: string; carAvailable?: boolean };
  companions: { usual: TravelCompanion[]; children: Array<{ ageGroup: ChildAgeGroup }>; usualPartySize?: number };
  travelStyle: Partial<{
    pace: number;
    novelty: number;
    crowdTolerance: number;
    walkingTolerance: number;
    transferTolerance: number;
    earlyMorningTolerance: number;
    lateNightTolerance: number;
    drivingTolerance: number;
    busTolerance: number;
  }>;
  preferences: Partial<Record<TravelPreference, number>>;
  transport: { maxTypicalTravelMinutes?: number | null; preferredMode?: "rail" | "car" | "bus" | "walking" };
  /** Optional user-authored hints, never booking facts or executable instructions. */
  notes?: { budget?: string; lodging?: string; food?: string; avoidances?: string };
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
  companions?: TravelCompanion[];
  interests?: Partial<Record<TravelPreference, number>>;
  pace?: number;
  maximumTravelMinutes?: number | null;
  relativeDistancePreference?: "nearer" | "farther";
  avoidances?: string[];
  carAvailable?: boolean;
  adventureIntensity?: 0 | 1 | 2 | 3;
  avoidedRisks?: AdventureRisk[];
}

export type AdventureRisk = "illegal" | "uncontrolled-violence" | "unverified-border" | "night-isolation" | "transport-stranding" | "weather-exposure";

export function travelStyleSummary(profile: UserProfile): string {
  const favorites = (Object.entries(profile.preferences) as Array<[TravelPreference, number]>)
    .filter(([, weight]) => weight >= 0.8)
    .map(([preference]) => travelPreferenceLabels[preference]);
  const favoriteText = favorites.length > 0 ? `${favorites.slice(0, 2).join("や")}を楽しみながら` : "気分に合う場所を選びながら";
  const paceText = profile.travelStyle.pace === undefined ? "ペースはまだ設定していません。"
    : profile.travelStyle.pace <= 0.4 ? "予定を詰め込みすぎず、ゆっくり過ごす旅を優先します。"
    : profile.travelStyle.pace >= 0.7 ? "いろいろな場所を巡る、充実した旅を楽しめそうです。"
      : "ゆとりと寄り道のバランスがよい旅を楽しめそうです。";
  const distanceText = profile.transport.maxTypicalTravelMinutes == null ? "移動時間は相談しながら" : "無理のない移動時間で";
  return `${favoriteText}、${distanceText}旅が好きそうです。${paceText}`;
}

export const travelPreferenceLabels: Record<TravelPreference, string> = {
  sea: "海", mountain: "山", nature: "自然", onsen: "温泉", food: "食", railway: "鉄道",
  history: "歴史", cityWalk: "街歩き", animals: "動物", art: "アート", themePark: "テーマパーク", shopping: "買い物",
};

export function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return profile.version === 2 && isObject(profile.home) &&
    (profile.home.carAvailable === undefined || typeof profile.home.carAvailable === "boolean") &&
    [profile.home.station, profile.home.area].every(optionalText) &&
    isObject(profile.companions) && Array.isArray(profile.companions.usual) && Array.isArray(profile.companions.children) &&
    profile.companions.usual.every((v) => ["solo", "partner", "friends", "children", "family"].includes(v)) &&
    profile.companions.children.every((v) => isObject(v) && ["baby", "preschool", "elementary", "teen"].includes(String(v.ageGroup))) &&
    (profile.companions.usualPartySize === undefined || Number.isSafeInteger(profile.companions.usualPartySize) &&
      Number(profile.companions.usualPartySize) >= 1 && Number(profile.companions.usualPartySize) <= 100) &&
    isObject(profile.travelStyle) && isObject(profile.preferences) && isObject(profile.transport) &&
    Object.values(profile.travelStyle).every(weight) && Object.values(profile.preferences).every(weight) &&
    (profile.transport.maxTypicalTravelMinutes == null || typeof profile.transport.maxTypicalTravelMinutes === "number" &&
      Number.isFinite(profile.transport.maxTypicalTravelMinutes) && profile.transport.maxTypicalTravelMinutes >= 0) &&
    (profile.transport.preferredMode === undefined || ["rail", "car", "bus", "walking"].includes(String(profile.transport.preferredMode))) &&
    (profile.notes === undefined || isObject(profile.notes) && Object.values(profile.notes).every(optionalText)) &&
    typeof profile.updatedAt === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function optionalText(value: unknown): boolean { return value === undefined || typeof value === "string" && value.length <= 500; }
function weight(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
