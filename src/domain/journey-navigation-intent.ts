import type { Train } from "@raiquora/train/train";
import type {
  JourneyRankingPreference,
  TransferPace,
} from "./journey-search-preferences";

export interface JourneyNavigationGuidance {
  excludedServiceTypes: string[];
  excludedTrainNames: string[];
  excludedTrainNumbers: string[];
  requiredServiceTypes: string[];
  requiredTrainNames: string[];
  requiredTrainNumbers: string[];
  allowedServiceTypes: string[];
  transferPace?: TransferPace;
  rankingPreference?: JourneyRankingPreference;
  maxTransfers?: 0 | 1 | 2 | 3;
}

export type UnsupportedJourneyExperience =
  | "fare"
  | "seat";

const defaultGuidance: JourneyNavigationGuidance = {
  excludedServiceTypes: [],
  excludedTrainNames: [],
  excludedTrainNumbers: [],
  requiredServiceTypes: [],
  requiredTrainNames: [],
  requiredTrainNumbers: [],
  allowedServiceTypes: [],
};

const standardServiceTypes = [
  "関空快速・紀州路快速",
  "区間新快速",
  "区間快速",
  "関空快速",
  "紀州路快速",
  "新幹線",
  "新快速",
  "特急",
  "快速",
  "普通",
];

const positiveJourneyPattern =
  /(?:乗りたい|のりたい|乗って(?:行きたい|いきたい)|使いたい|利用したい|で(?:行きたい|いきたい)|だけで(?:行きたい|いきたい)|のみで(?:行きたい|いきたい))/u;
const avoidancePattern =
  /(?:使いたくない|使わない|使わず|乗りたくない|乗らない|なし|避けたい|避けて|外して|除外|以外)/u;

export function journeyNavigationGuidanceFromPrompt(
  prompt: string,
  trains: Train[],
): JourneyNavigationGuidance | undefined {
  const normalized = normalize(prompt);
  const hasAvoidanceIntent = avoidancePattern.test(normalized);
  const isConventionalOnly = /在来線(?:だけ|のみ)?で?(?:行きたい|いきたい|行く)/u
    .test(normalized);
  const isLocalOnly = /(?:鈍行|各駅停車|普通(?:列車)?)(?:だけ|のみ)?で?(?:行きたい|いきたい|行く|お願い)|(?:鈍行|各駅停車|普通列車)(?:だけ|のみ)/u
    .test(normalized);
  const hasPositiveIntent = positiveJourneyPattern.test(normalized) || isLocalOnly;
  const excludedTrainNames = hasAvoidanceIntent
    ? matchingTrainNames(normalized, trains)
    : [];
  const excludedTrainNumbers = hasAvoidanceIntent
    ? matchingTrainNumbers(normalized, trains)
    : [];
  const excludedServiceTypes = unique([
    ...(hasAvoidanceIntent
      ? matchingServiceTypes(normalized, trains, excludedTrainNames)
      : []),
    ...(isConventionalOnly ? ["新幹線"] : []),
  ]);
  const requiredTrainNames = hasPositiveIntent && !isLocalOnly
    ? matchingTrainNames(normalized, trains)
    : [];
  const requiredTrainNumbers = hasPositiveIntent && !isLocalOnly
    ? matchingTrainNumbers(normalized, trains)
    : [];
  const requiredServiceTypes = isLocalOnly
    ? []
    : hasPositiveIntent
    ? matchingServiceTypes(normalized, trains, requiredTrainNames)
    : [];
  const allowedServiceTypes = isLocalOnly ? ["普通"] : [];
  const transferPace: TransferPace | undefined =
    /ゆっくり|余裕を(?:持って|もって)|乗換(?:に)?余裕/u
      .test(normalized)
    ? "relaxed"
    : /急いで|急ぎで|乗換を急/u.test(normalized)
    ? "hurried"
    : undefined;
  const rankingPreference: JourneyRankingPreference | undefined =
    /早く着|最速|到着を早/u.test(normalized)
    ? "earliest-arrival"
    : /遅く出|家を遅く|出発を遅/u.test(normalized)
    ? "latest-departure"
    : /乗換(?:が|を)?少な|乗換なしを優先/u.test(normalized)
    ? "fewest-transfers"
    : undefined;
  const maxTransfers: 0 | 1 | 2 | 3 | undefined =
    /乗換(?:え)?なし|乗換(?:え)?たくない|直通だけ/u.test(normalized)
    ? 0
    : transferLimit(normalized);

  const guidance = {
    excludedServiceTypes,
    excludedTrainNames,
    excludedTrainNumbers,
    requiredServiceTypes,
    requiredTrainNames,
    requiredTrainNumbers,
    allowedServiceTypes,
    ...(transferPace ? { transferPace } : {}),
    ...(rankingPreference ? { rankingPreference } : {}),
    ...(maxTransfers === undefined ? {} : { maxTransfers }),
  };
  return hasJourneyNavigationGuidance(guidance) ? guidance : undefined;
}

export function mergeJourneyNavigationGuidance(
  base: JourneyNavigationGuidance | undefined,
  addition: JourneyNavigationGuidance | undefined,
): JourneyNavigationGuidance {
  const restrictsToAllowedTypes = Boolean(addition?.allowedServiceTypes.length);
  const addsRequiredService = Boolean(
    addition && (
      addition.requiredServiceTypes.length ||
      addition.requiredTrainNames.length ||
      addition.requiredTrainNumbers.length
    ),
  );
  const addedExcludedServiceTypes = addition?.excludedServiceTypes ?? [];
  const addedExcludedTrainNames = addition?.excludedTrainNames ?? [];
  const addedExcludedTrainNumbers = addition?.excludedTrainNumbers ?? [];
  const addedRequiredServiceTypes = addition?.requiredServiceTypes ?? [];
  const addedRequiredTrainNames = addition?.requiredTrainNames ?? [];
  const addedRequiredTrainNumbers = addition?.requiredTrainNumbers ?? [];
  const addedAllowedServiceTypes = addition?.allowedServiceTypes ?? [];
  return {
    excludedServiceTypes: unique([
      ...(base?.excludedServiceTypes ?? []),
      ...addedExcludedServiceTypes,
    ]).filter((value) =>
      !addedRequiredServiceTypes.includes(value) &&
      !addedAllowedServiceTypes.includes(value)
    ),
    excludedTrainNames: unique([
      ...(base?.excludedTrainNames ?? []),
      ...addedExcludedTrainNames,
    ]).filter((value) => !addedRequiredTrainNames.includes(value)),
    excludedTrainNumbers: unique([
      ...(base?.excludedTrainNumbers ?? []),
      ...addedExcludedTrainNumbers,
    ]).filter((value) => !addedRequiredTrainNumbers.includes(value)),
    requiredServiceTypes: unique([
      ...(restrictsToAllowedTypes ? [] : base?.requiredServiceTypes ?? []),
      ...addedRequiredServiceTypes,
    ]).filter((value) => !addedExcludedServiceTypes.includes(value)),
    requiredTrainNames: unique([
      ...(restrictsToAllowedTypes ? [] : base?.requiredTrainNames ?? []),
      ...addedRequiredTrainNames,
    ]).filter((value) => !addedExcludedTrainNames.includes(value)),
    requiredTrainNumbers: unique([
      ...(restrictsToAllowedTypes ? [] : base?.requiredTrainNumbers ?? []),
      ...addedRequiredTrainNumbers,
    ]).filter((value) => !addedExcludedTrainNumbers.includes(value)),
    allowedServiceTypes:
      addition?.allowedServiceTypes.length
        ? addition.allowedServiceTypes
        : addsRequiredService
        ? []
        : base?.allowedServiceTypes ?? [],
    transferPace: addition?.transferPace ?? base?.transferPace,
    rankingPreference:
      addition?.rankingPreference ?? base?.rankingPreference,
    maxTransfers: addition?.maxTransfers ?? base?.maxTransfers,
  };
}

export function hasJourneyNavigationGuidance(
  guidance: JourneyNavigationGuidance | undefined,
): guidance is JourneyNavigationGuidance {
  return Boolean(guidance && (
    guidance.excludedServiceTypes.length > 0 ||
    guidance.excludedTrainNames.length > 0 ||
    guidance.excludedTrainNumbers.length > 0 ||
    guidance.requiredServiceTypes.length > 0 ||
    guidance.requiredTrainNames.length > 0 ||
    guidance.requiredTrainNumbers.length > 0 ||
    guidance.allowedServiceTypes.length > 0 ||
    guidance.transferPace ||
    guidance.rankingPreference ||
    guidance.maxTransfers !== undefined
  ));
}

export function journeyNavigationGuidanceResponse(
  guidance: JourneyNavigationGuidance,
): string {
  const labels = journeyNavigationGuidanceLabels(guidance);
  return `${labels.join("・")}の希望を覚えました。出発駅と到着駅を教えてください。`;
}

export function journeyNavigationGuidanceLabels(
  guidance: JourneyNavigationGuidance,
): string[] {
  return unique([
    ...guidance.excludedServiceTypes.map((value) => `${value}を使わない`),
    ...guidance.excludedTrainNames.map((value) => `${value}を使わない`),
    ...guidance.excludedTrainNumbers.map((value) => `${value}を使わない`),
    ...guidance.requiredServiceTypes.map((value) => `${value}を利用`),
    ...guidance.requiredTrainNames.map((value) => `${value}を利用`),
    ...guidance.requiredTrainNumbers.map((value) => `${value}を利用`),
    ...(guidance.allowedServiceTypes.length
      ? [`${guidance.allowedServiceTypes.join("・")}だけ`]
      : []),
    ...(guidance.maxTransfers === 0 ? ["乗換なし"] : []),
    ...(guidance.maxTransfers && guidance.maxTransfers > 0
      ? [`乗換${guidance.maxTransfers}回まで`]
      : []),
    ...(guidance.transferPace === "relaxed" ? ["乗換はゆっくり"] : []),
    ...(guidance.transferPace === "hurried" ? ["乗換は急ぐ"] : []),
    ...(guidance.rankingPreference === "earliest-arrival"
      ? ["早く着く"]
      : []),
    ...(guidance.rankingPreference === "latest-departure"
      ? ["遅く出る"]
      : []),
    ...(guidance.rankingPreference === "fewest-transfers"
      ? ["乗換少なめ"]
      : []),
  ]);
}

export function emptyJourneyNavigationGuidance(): JourneyNavigationGuidance {
  return { ...defaultGuidance };
}

export function unsupportedJourneyExperienceFromPrompt(
  prompt: string,
): UnsupportedJourneyExperience | undefined {
  const normalized = normalize(prompt);
  if (/安く|最安|運賃|料金/u.test(normalized)) return "fare";
  if (/指定席|自由席|グリーン車|座席/u.test(normalized)) return "seat";
  return undefined;
}

export function unsupportedJourneyExperienceResponse(
  experience: UnsupportedJourneyExperience,
): string {
  const unavailable = {
    fare: "運賃と料金の比較",
    seat: "座席設備と空席の比較",
  }[experience];
  return `${unavailable}はまだ検索条件へ反映できません。現在は乗りたい列車や種別 鈍行限定 乗換回数 出発時刻と到着時刻を指定できます。`;
}

function matchingTrainNames(prompt: string, trains: Train[]): string[] {
  const values = trains.flatMap((train) => {
    const fullName = normalize(train.train_name);
    if (!fullName) return [];
    const familyName = fullName.replace(/[0-9]+号$/u, "");
    if (prompt.includes(fullName)) return [fullName];
    return familyName.length >= 2 && prompt.includes(familyName)
      ? [familyName]
      : [];
  });
  return mostSpecific(unique(values));
}

function matchingTrainNumbers(prompt: string, trains: Train[]): string[] {
  return unique(trains
    .map((train) => normalize(train.train_no))
    .filter((value) => value.length >= 2 && prompt.includes(value)));
}

function matchingServiceTypes(
  prompt: string,
  trains: Train[],
  trainNames: string[],
): string[] {
  const candidates = mostSpecific(unique([
    ...standardServiceTypes,
    ...trains.map((train) => normalize(train.service_type)),
  ].filter((value) => prompt.includes(value))));
  return candidates.filter((serviceType) =>
    !trainNames.some((trainName) => prompt.includes(`${serviceType}${trainName}`))
  );
}

function transferLimit(prompt: string): 1 | 2 | 3 | undefined {
  const value = /乗換(?:え)?([1-3])回(?:まで|以内)/u.exec(prompt)?.[1];
  return value ? Number(value) as 1 | 2 | 3 : undefined;
}

function mostSpecific(values: string[]): string[] {
  return values.filter((value, _index, all) =>
    !all.some((other) => other.length > value.length && other.includes(value))
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").replace(/乗り換え/gu, "乗換");
}
