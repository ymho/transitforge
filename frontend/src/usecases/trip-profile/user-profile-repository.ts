import {
  isUserProfile,
  type UserProfile,
} from "@raiquora/trip/travel-profile";

export const travelProfileStorageKey = "transitforge.travel-profile.v2";
export const travelProfileChangedEvent = "transitforge:travel-profile-changed";

interface ReadableProfileStorage {
  getItem(key: string): string | null;
}

interface WritableProfileStorage {
  setItem(key: string, value: string): void;
}

interface RemovableProfileStorage {
  removeItem(key: string): void;
}

export function loadUserProfile(
  storage: ReadableProfileStorage,
): UserProfile | undefined {
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
  storage: WritableProfileStorage,
  profile: Omit<UserProfile, "version" | "updatedAt">,
  now: Date = new Date(),
): UserProfile {
  const saved: UserProfile = {
    ...profile,
    version: 2,
    updatedAt: now.toISOString(),
  };
  storage.setItem(travelProfileStorageKey, JSON.stringify(saved));
  return saved;
}

export function deleteUserProfile(
  storage: RemovableProfileStorage,
): void {
  storage.removeItem(travelProfileStorageKey);
}
