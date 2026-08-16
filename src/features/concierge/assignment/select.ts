import { concierges } from "../profiles";
import type { ConciergeProfile } from "../types";
import { scoreConcierge, type UserTravelPreference } from "./score";

export function selectConcierge(
  preference: UserTravelPreference,
): ConciergeProfile {
  return [...concierges]
    .map((concierge) => ({
      concierge,
      score: scoreConcierge(preference, concierge),
    }))
    .sort((a, b) => b.score - a.score)[0].concierge;
}
