export const travelProfileStorageKey = "transitforge.travel-profile.v1";

export type TravelPace = "relaxed" | "balanced" | "active";
export type TravelCompanion = "solo" | "partner" | "family" | "children" | "friends";

export interface UserProfile {
  version: 1;
  homeStation: string;
  companions: TravelCompanion[];
  childAgeBands: string[];
  interests: string[];
  pace: TravelPace;
  maximumTravelMinutes: number;
  avoidances: string[];
  carAvailable: boolean;
  updatedAt: string;
}

export interface TripContext {
  destinationWish?: string;
  startDate?: string;
  endDate?: string;
  companions?: TravelCompanion[];
  interests?: string[];
  pace?: TravelPace;
  maximumTravelMinutes?: number;
  avoidances?: string[];
  carAvailable?: boolean;
}

export function loadUserProfile(storage: Pick<Storage, "getItem">): UserProfile | undefined {
  const raw = storage.getItem(travelProfileStorageKey);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return isUserProfile(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveUserProfile(
  storage: Pick<Storage, "setItem">,
  profile: Omit<UserProfile, "version" | "updatedAt">,
  now: Date = new Date(),
): UserProfile {
  const saved: UserProfile = { ...profile, version: 1, updatedAt: now.toISOString() };
  storage.setItem(travelProfileStorageKey, JSON.stringify(saved));
  return saved;
}

export function deleteUserProfile(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(travelProfileStorageKey);
}

function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return profile.version === 1 && typeof profile.homeStation === "string" &&
    Array.isArray(profile.companions) && Array.isArray(profile.childAgeBands) &&
    Array.isArray(profile.interests) && ["relaxed", "balanced", "active"].includes(String(profile.pace)) &&
    typeof profile.maximumTravelMinutes === "number" && Number.isFinite(profile.maximumTravelMinutes) &&
    Array.isArray(profile.avoidances) && typeof profile.carAvailable === "boolean" &&
    typeof profile.updatedAt === "string";
}
