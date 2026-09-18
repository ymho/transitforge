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
  return readUserProfile(storage).profile;
}

/** Distinguish absence, corruption and browser denial. Never remove or overwrite a failed read. */
export function readUserProfile(storage: ReadableProfileStorage): {
  status: "available" | "empty" | "invalid" | "unavailable";
  profile?: UserProfile;
} {
  let raw: string | null;
  try { raw = storage.getItem(travelProfileStorageKey); } catch { return { status: "unavailable" }; }
  if (!raw) return { status: "empty" };
  try {
    const value: unknown = JSON.parse(raw);
    return isUserProfile(value) ? { status: "available", profile: value } : { status: "invalid" };
  } catch {
    return { status: "invalid" };
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
  if (!isUserProfile(saved)) throw new Error("Invalid travel profile");
  storage.setItem(travelProfileStorageKey, JSON.stringify(saved));
  return saved;
}

export function deleteUserProfile(
  storage: RemovableProfileStorage,
): void {
  storage.removeItem(travelProfileStorageKey);
}
