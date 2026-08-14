export type TransferPace = "hurried" | "standard" | "relaxed";

export type JourneyRankingPreference =
  | "balanced"
  | "earliest-arrival"
  | "latest-departure"
  | "fewest-transfers";

export interface JourneySearchPreferences {
  transferPace: TransferPace;
  rankingPreference: JourneyRankingPreference;
  maxTransfers: 3;
}

export const defaultJourneySearchPreferences: JourneySearchPreferences = {
  transferPace: "standard",
  rankingPreference: "balanced",
  maxTransfers: 3,
};

export function journeySearchPreferencesFromPrompt(
  prompt: string,
  defaults: JourneySearchPreferences,
): JourneySearchPreferences {
  const normalized = prompt.normalize("NFKC").replace(/\s+/gu, "");
  let transferPace = defaults.transferPace;
  let rankingPreference = defaults.rankingPreference;

  if (/ゆっくり|余裕を(?:持って|もって)|乗換(?:に)?余裕/u.test(normalized)) {
    transferPace = "relaxed";
  } else if (/急いで|急ぎで|乗換を急/u.test(normalized)) {
    transferPace = "hurried";
  }

  if (/早く着|最速|到着を早/u.test(normalized)) {
    rankingPreference = "earliest-arrival";
  } else if (/遅く出|家を遅く|出発を遅/u.test(normalized)) {
    rankingPreference = "latest-departure";
  } else if (/乗換(?:が|を)?少な|乗換なしを優先/u.test(normalized)) {
    rankingPreference = "fewest-transfers";
  } else if (/バランス/u.test(normalized)) {
    rankingPreference = "balanced";
  }

  return { transferPace, rankingPreference, maxTransfers: 3 };
}

export function isTransferPace(value: unknown): value is TransferPace {
  return value === "hurried" || value === "standard" || value === "relaxed";
}

export function isJourneyRankingPreference(
  value: unknown,
): value is JourneyRankingPreference {
  return value === "balanced" ||
    value === "earliest-arrival" ||
    value === "latest-departure" ||
    value === "fewest-transfers";
}
