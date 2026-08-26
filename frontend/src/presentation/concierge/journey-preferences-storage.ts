import {
  defaultJourneySearchPreferences,
  isJourneyRankingPreference,
  isTransferPace,
  type JourneySearchPreferences,
} from "@raiquora/journey/journey-search-preferences";

const storageKey = "transitforge.journey-search-preferences.v1";

export function loadJourneySearchPreferences(
  storage: Pick<Storage, "getItem">,
): JourneySearchPreferences {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "transferPace" in value &&
      "rankingPreference" in value &&
      isTransferPace(value.transferPace) &&
      isJourneyRankingPreference(value.rankingPreference)
    ) {
      return {
        transferPace: value.transferPace,
        rankingPreference: value.rankingPreference,
        maxTransfers: 3,
      };
    }
  } catch {
    // 読み込めない保存値は既定値へ戻す
  }
  return { ...defaultJourneySearchPreferences };
}

export function saveJourneySearchPreferences(
  storage: Pick<Storage, "setItem">,
  preferences: JourneySearchPreferences,
): void {
  try {
    storage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // 保存できなくても現在の検索設定は使える
  }
}
