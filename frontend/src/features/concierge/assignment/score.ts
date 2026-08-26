import type { CompanionType, ConciergeProfile, TravelInterest } from "../types";

export interface UserTravelPreference {
  companion?: CompanionType;
  companions?: CompanionType[];
  interests?: Partial<Record<TravelInterest, number>>;
  pace?: number;
}

export function scoreConcierge(
  user: UserTravelPreference,
  concierge: ConciergeProfile,
): number {
  const companions = user.companions?.length
    ? user.companions
    : user.companion === undefined ? [] : [user.companion];
  const companionScore = companions.length === 0
    ? 0.5
    : companions.reduce(
      (sum, companion) =>
        sum + (concierge.assignment.affinity.companions[companion] ?? 0.3),
      0,
    ) / companions.length;

  const interestEntries = Object.entries(user.interests ?? {});
  const interestScore =
    interestEntries.length === 0
      ? 0.5
      : interestEntries.reduce((sum, [interest, weight]) => {
          const key = interest as TravelInterest;
          const affinity =
            concierge.assignment.affinity.interests[key] ??
            concierge.travelStyle.interests[key] ??
            0.2;
          return sum + affinity * (weight ?? 0);
        }, 0) / interestEntries.length;

  const paceScore =
    user.pace == null
      ? 0.5
      : Math.max(0, 1 - Math.abs(user.pace - concierge.travelStyle.pace));

  return (
    companionScore * 0.30 +
    interestScore * 0.50 +
    paceScore * 0.20
  ) * concierge.assignment.priority;
}
