import type { ConversationQualityScenario } from "./evaluation-contract";

export interface ConversationQualityLiveTurn {
  response: string;
  toolNames: string[];
  photoCount: number;
}

export interface ConversationQualityLiveResult {
  id: string;
  name: string;
  passed: boolean;
  metrics: {
    toolSelectionAccuracy: number;
    constraintSatisfaction: number;
    groundedClaimRate: number | null;
    unsupportedClaimRate: number | null;
    taskCompletion: number;
  };
  capabilities: Record<string, boolean>;
  failures: string[];
}

/** Transparent, deterministic checks for the real-conversation regressions in Issue #474. */
export function evaluateConversationQualityLive(
  scenario: ConversationQualityScenario,
  turns: readonly ConversationQualityLiveTurn[],
): ConversationQualityLiveResult {
  const responses = turns.map(({ response }) => response);
  const combined = responses.join("\n");
  const expected = scenario.expected;
  const destinationChecks = expected.destination.mode === "specified"
    ? [
        includes(combined, expected.destination.name),
        includes(combined, expected.destination.municipality),
        expected.destination.forbiddenMunicipalities.every((name) => !includes(combined, name)),
      ]
    : [
        candidateCount(combined) >= expected.destination.minimumCandidates,
        candidateCount(combined) <= expected.destination.maximumCandidates,
        expected.destination.forbiddenMainCandidates.every((name) => !includes(combined, name)),
      ];
  const dateChecks = expected.relativeDates.map(({ calendarDate }) => mentionsDate(combined, calendarDate));
  const repeatedQuestionChecks = expected.forbiddenRepeatedQuestions.map((key) =>
    !responses.some((response) => forbiddenQuestion(response, key)));
  const profilePromotionChecks = expected.forbiddenProfilePromotions.map((key) =>
    !responses.some((response) => promotesToProfile(response, key)));
  const constraintChecks = [...destinationChecks, ...dateChecks, ...repeatedQuestionChecks, ...profilePromotionChecks];
  const capabilities = Object.fromEntries(expected.requiredFinalCapabilities.map((capability) => [
    capability,
    hasCapability(capability, combined, turns),
  ]));
  const firstStarterPlan = responses.findIndex((response) => starterPlan(response)) + 1;
  const askOnlyStreak = maximumAskOnlyStreak(responses);
  const maximumQuestions = Math.max(0, ...responses.map(questionCount));
  const assumptionCheck = !expected.assumptions.mustBeExplicit || !usesUnconfirmedDetails(combined) ||
    /仮定|想定|前提|未指定|未確認|分からない|わからない/u.test(combined);
  const progressChecks = [
    firstStarterPlan > 0 && firstStarterPlan <= expected.maximumTurnsToStarterPlan,
    askOnlyStreak <= expected.maximumAskOnlyStreak,
    maximumQuestions <= expected.maximumQuestionsPerAssistantTurn,
    turns.reduce((sum, turn) => sum + turn.photoCount, 0) >= expected.minimumPlacePhotos,
    assumptionCheck,
  ];
  const toolSelectionAccuracy = requiredToolUse(scenario, turns) ? 1 : 0;
  const constraintSatisfaction = average([...constraintChecks, assumptionCheck]);
  const taskChecks = [...Object.values(capabilities), ...progressChecks];
  const taskCompletion = average(taskChecks);
  const groundingChecks = expected.destination.mode === "specified"
    ? [includes(combined, expected.destination.name), turns.some(({ photoCount }) => photoCount > 0)]
    : westJapanCandidateNames.filter((name) => includes(combined, name)).map((name) => supportedCandidate(name, turns));
  const groundedClaimRate = groundingChecks.length ? average(groundingChecks) : null;
  const unsupportedClaimRate = groundedClaimRate === null ? null : 1 - groundedClaimRate;
  const failures: string[] = [];
  if (toolSelectionAccuracy < 1) failures.push("必要な調査Toolが使われていない");
  if (constraintSatisfaction < 1) failures.push("既知条件、相対日付、地域制約、質問抑制のいずれかを満たしていない");
  if (taskCompletion < 1) failures.push("初回提案、旅程、宿、概算、写真のいずれかが不足している");
  if ((groundedClaimRate ?? 1) < 1) failures.push("回答候補とToolで確認した候補が一致していない");
  return {
    id: scenario.id,
    name: scenario.name,
    passed: failures.length === 0,
    metrics: { toolSelectionAccuracy, constraintSatisfaction, groundedClaimRate, unsupportedClaimRate, taskCompletion },
    capabilities,
    failures,
  };
}

const westJapanCandidateNames = ["城崎温泉", "おごと温泉", "有馬温泉"];

function hasCapability(capability: string, text: string, turns: readonly ConversationQualityLiveTurn[]): boolean {
  if (capability === "destination_overview") return /出雲大社/u.test(text) && /出雲市/u.test(text);
  if (capability === "provisional_itinerary") return starterPlan(text);
  if (capability === "lodging_suggestions") return /宿|旅館|ホテル/u.test(text);
  if (capability === "whole_trip_cost_estimate") return /概算|予算|合計/u.test(text) && /円/u.test(text);
  if (capability === "place_photo") return turns.some(({ photoCount }) => photoCount >= 1);
  if (capability === "multiple_destination_candidates") return candidateCount(text) >= 2;
  if (capability === "candidate_comparison") return candidateCount(text) >= 2 && /おすすめ|向いて|理由|特徴|アクセス/u.test(text);
  if (capability === "candidate_specific_itineraries") return candidateCount(text) >= 2 && occurrences(text, /1日目|日帰り|午前|午後/gu) >= 2;
  if (capability === "candidate_photos") return turns.reduce((sum, turn) => sum + turn.photoCount, 0) >= 2;
  return false;
}

function requiredToolUse(scenario: ConversationQualityScenario, turns: readonly ConversationQualityLiveTurn[]): boolean {
  const names = new Set(turns.flatMap(({ toolNames }) => toolNames));
  if (scenario.expected.destination.mode === "specified") {
    return names.has("search_place_media") || names.has("resolve_place_candidates");
  }
  return names.has("search_web") && (names.has("resolve_place_candidates") || names.has("search_place_media"));
}

function supportedCandidate(name: string, turns: readonly ConversationQualityLiveTurn[]): boolean {
  return turns.some(({ response, photoCount }) => includes(response, name) && photoCount > 0);
}

function candidateCount(text: string): number {
  return westJapanCandidateNames.filter((name) => includes(text, name)).length;
}

function mentionsDate(text: string, calendarDate: string): boolean {
  const [year, month, day] = calendarDate.split("-").map(Number);
  return includes(text, calendarDate) || includes(text, `${year}年${month}月${day}日`) || includes(text, `${month}月${day}日`);
}

function forbiddenQuestion(text: string, key: string): boolean {
  const patterns: Record<string, RegExp> = {
    travel_start_date: /(?:出発日|いつ(?:から|出発)|明日は何日).{0,40}(?:[?？]|ですか|ますか)/u,
    stay_nights: /(?:泊数|何泊|滞在期間).{0,40}(?:[?？]|ですか|ますか)/u,
    destination: /(?:行き先|目的地|どこへ|どちらへ).{0,40}(?:[?？]|ですか|ますか)/u,
    origin: /(?:出発地|出発駅|どこから).{0,40}(?:[?？]|ですか|ますか)/u,
    budget: /(?:予算).{0,40}(?:[?？]|ですか|ますか)/u,
    interests: /(?:興味|重視|希望).{0,40}(?:[?？]|ですか|ますか)/u,
  };
  return patterns[key]?.test(text) ?? false;
}

function promotesToProfile(text: string, key: string): boolean {
  const labels: Record<string, string> = {
    origin: "出発地|出発駅",
    party_size: "人数|同行者",
    favorite_interests: "好み|興味",
    activities: "アクティビティ|過ごし方",
  };
  const label = labels[key];
  if (!label) return false;
  return new RegExp(`(?:${label}).{0,40}(?:プロフィール|記憶|保存|登録|今後も|次回から)|(?:プロフィール|記憶|保存|登録).{0,40}(?:${label})`, "u").test(text);
}

function starterPlan(text: string): boolean {
  return /1日目|2日目|モデルコース|午前|午後|朝.+昼|昼.+夕/u.test(text);
}

function usesUnconfirmedDetails(text: string): boolean {
  return /\b[1-9]\d*(?:人|名)\b|向日町|京都発|大阪発|\b[1-9]\d*泊\b/u.test(text);
}

function maximumAskOnlyStreak(responses: readonly string[]): number {
  let maximum = 0, current = 0;
  for (const response of responses) {
    current = questionCount(response) > 0 && !starterPlan(response) ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function questionCount(text: string): number {
  return occurrences(text, /[?？]/gu) + occurrences(text, /(?:です|ます|でしょう)か[。！]/gu);
}

function occurrences(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function includes(text: string, value: string): boolean {
  return text.normalize("NFKC").toLocaleLowerCase("ja").includes(value.normalize("NFKC").toLocaleLowerCase("ja"));
}

function average(values: readonly boolean[]): number {
  return values.length ? values.filter(Boolean).length / values.length : 1;
}
