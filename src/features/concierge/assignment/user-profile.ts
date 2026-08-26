import type { UserProfile } from "@raiquora/trip/travel-profile";
import { akari } from "../profiles/akari";
import type { ConciergeProfile } from "../types";
import { selectConcierge } from "./select";

export function selectConciergeForUserProfile(
  profile: UserProfile | undefined,
): ConciergeProfile {
  if (profile === undefined) {
    return akari;
  }
  return selectConcierge({
    companions: profile.companions.usual,
    interests: profile.preferences,
    pace: profile.travelStyle.pace,
  });
}
