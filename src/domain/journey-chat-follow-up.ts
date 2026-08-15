import type {
  JourneyRouteLeg,
  JourneyRouteResult,
} from "./direct-route-search";
import type { ViewerAgentJourneyPlan } from "./viewer-agent-response";

export interface PendingJourneyLegChange {
  plan: ViewerAgentJourneyPlan;
  journeyIndex: number;
  legIndex: number;
  alternatives: JourneyRouteLeg[];
}

export interface JourneySearchExclusions {
  serviceTypes: string[];
  trainNames: string[];
  trainNumbers: string[];
  serviceUids: string[];
}

export type JourneyChatFollowUpIntent =
  | { type: "intermediate-stops"; journeyIndex: number; legIndex: number }
  | { type: "exclude-trains"; exclusions: JourneySearchExclusions }
  | {
      type: "alternative";
      journeyIndex: number;
      legIndex: number;
      preferLaterDeparture: boolean;
    }
  | { type: "confirm-alternative"; alternativeIndex: number };

export type JourneyLegAlternativeSearch = (request: {
  plan: ViewerAgentJourneyPlan;
  journey: JourneyRouteResult;
  leg: JourneyRouteLeg;
  legIndex: number;
}) => Promise<JourneyRouteLeg[]>;

export function journeyChatFollowUpIntent(
  prompt: string,
  plan: ViewerAgentJourneyPlan | undefined,
  pending?: PendingJourneyLegChange,
): JourneyChatFollowUpIntent | undefined {
  const normalized = normalize(prompt);
  if (pending) {
    const alternativeIndex = confirmedAlternativeIndex(normalized, pending);
    if (alternativeIndex !== undefined) {
      return { type: "confirm-alternative", alternativeIndex };
    }
  }
  if (!plan) {
    return undefined;
  }
  const exclusions = trainExclusions(normalized, plan);
  if (exclusions) {
    return { type: "exclude-trains", exclusions };
  }
  const wantsIntermediateStops = /(途中駅|停車駅|停車する駅)/u.test(normalized);
  const wantsAlternative = /(別の列車|違う列車|ほかの列車|他の列車|列車を変)/u.test(
    normalized,
  );
  if (!wantsIntermediateStops && !wantsAlternative) {
    return undefined;
  }
  const referenced = referencedLeg(normalized, plan);
  if (!referenced) {
    return undefined;
  }
  if (wantsIntermediateStops) {
    return { type: "intermediate-stops", ...referenced };
  }
  return {
    type: "alternative",
    ...referenced,
    preferLaterDeparture: /(遅く家を出|遅く出|後の列車|後発)/u.test(normalized),
  };
}

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

const avoidancePattern =
  /(?:使いたくない|使わない|使わず|乗りたくない|乗らない|なし|避けたい|避けて|外して|除外|以外)/u;

function trainExclusions(
  prompt: string,
  plan: ViewerAgentJourneyPlan,
): JourneySearchExclusions | undefined {
  if (!avoidancePattern.test(prompt)) {
    return undefined;
  }
  const legs = plan.journeys.flatMap((journey) => journey.legs);
  const trainNames = unique(legs.flatMap((leg) => {
    const fullName = normalize(leg.trainName);
    if (!fullName) {
      return [];
    }
    const familyName = fullName.replace(/[0-9]+号$/u, "");
    if (prompt.includes(fullName)) {
      return [fullName];
    }
    return familyName.length >= 2 && prompt.includes(familyName)
      ? [familyName]
      : [];
  }));
  const explicitTrainNumbers = unique(legs
    .map((leg) => normalize(leg.trainNumber))
    .filter((value) => value.length >= 2 && prompt.includes(value)));
  const serviceTypeCandidates = unique([
    ...standardServiceTypes,
    ...legs.map((leg) => normalize(leg.serviceType)),
  ]).sort((left, right) => right.length - left.length);
  const serviceTypes = serviceTypeCandidates.filter((serviceType) => {
    if (!prompt.includes(serviceType)) {
      return false;
    }
    return !trainNames.some((trainName) =>
      prompt.includes(`${serviceType}${trainName}`)
    );
  }).filter((serviceType, _index, matched) =>
    !matched.some((other) =>
      other.length > serviceType.length && other.includes(serviceType)
    )
  );

  const explicit = serviceTypes.length > 0 ||
    trainNames.length > 0 || explicitTrainNumbers.length > 0;
  const contextualLeg = explicit ? undefined : referencedExcludedLeg(prompt, plan);
  const serviceUids = contextualLeg ? [contextualLeg.serviceUid] : [];
  const trainNumbers = unique([
    ...explicitTrainNumbers,
    ...(contextualLeg?.trainNumber ? [contextualLeg.trainNumber] : []),
  ]);
  if (!explicit && serviceUids.length === 0) {
    return undefined;
  }
  return { serviceTypes, trainNames, trainNumbers, serviceUids };
}

function referencedExcludedLeg(
  prompt: string,
  plan: ViewerAgentJourneyPlan,
): JourneyRouteLeg | undefined {
  const journey = plan.journeys[0];
  if (!journey) {
    return undefined;
  }
  const numbered = /([1-9])本目(?:の列車)?/u.exec(prompt)?.[1];
  if (numbered) {
    return journey.legs[Number(numbered) - 1];
  }
  const byOrigin = journey.legs.find((leg) =>
    prompt.includes(normalizeStation(leg.originStation))
  );
  if (byOrigin && /(?:から乗る|からの)(?:列車)?/u.test(prompt)) {
    return byOrigin;
  }
  return /(?:この列車|これ)/u.test(prompt) ? journey.legs[0] : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function intermediateStopsResponse(
  plan: ViewerAgentJourneyPlan,
  journeyIndex: number,
  legIndex: number,
): string {
  const leg = plan.journeys[journeyIndex]?.legs[legIndex];
  if (!leg) {
    return "対象の区間を特定できませんでした。";
  }
  const stops = leg.stops?.slice(1, -1) ?? [];
  if (stops.length === 0) {
    return `${stationLabel(leg.originStation)}から${stationLabel(leg.destinationStation)}までに途中停車駅はありません。`;
  }
  const values = stops.map((stop) => {
    const time = stop.departureTimeMinutes ?? stop.arrivalTimeMinutes;
    return time === undefined
      ? stationLabel(stop.stationName)
      : `${formatClock(time)} ${stationLabel(stop.stationName)}`;
  });
  return `${stationLabel(leg.originStation)}から${stationLabel(leg.destinationStation)}までの途中停車駅は ${values.join(" → ")} です。`;
}

export function alternativeProposalResponse(
  current: JourneyRouteLeg,
  alternatives: JourneyRouteLeg[],
): string {
  if (alternatives.length === 0) {
    return `${stationLabel(current.originStation)}から${stationLabel(current.destinationStation)}までで変更できる列車は見つかりませんでした。`;
  }
  const options = alternatives.map((leg, index) => {
    const train = [leg.serviceType, leg.trainName || leg.trainNumber]
      .filter(Boolean)
      .join(" ");
    return `${index + 1}. ${formatClock(leg.departureTimeMinutes)} → ${formatClock(leg.arrivalTimeMinutes)} ${train}`;
  });
  return [
    `${stationLabel(current.originStation)}から${stationLabel(current.destinationStation)}までの別の列車です。まだ経路は変更していません。`,
    ...options,
    "番号か列車名を指定すると経路へ反映します。",
  ].join("\n");
}

export function applyJourneyLegAlternative(
  pending: PendingJourneyLegChange,
  alternativeIndex: number,
): ViewerAgentJourneyPlan {
  const alternative = pending.alternatives[alternativeIndex];
  const selectedJourney = pending.plan.journeys[pending.journeyIndex];
  if (!alternative || !selectedJourney) {
    return pending.plan;
  }
  const legs = selectedJourney.legs.map((leg, index) =>
    index === pending.legIndex ? alternative : leg,
  );
  const journey = {
    ...selectedJourney,
    legs,
    departureTimeMinutes: legs[0]?.departureTimeMinutes ?? selectedJourney.departureTimeMinutes,
    arrivalTimeMinutes:
      legs.at(-1)?.arrivalTimeMinutes ?? selectedJourney.arrivalTimeMinutes,
  };
  return {
    ...pending.plan,
    journeys: pending.plan.journeys.map((candidate, index) =>
      index === pending.journeyIndex ? journey : candidate,
    ),
  };
}

export function appliedAlternativeResponse(
  pending: PendingJourneyLegChange,
  alternativeIndex: number,
): string {
  const leg = pending.alternatives[alternativeIndex];
  if (!leg) {
    return "列車を変更できませんでした。";
  }
  const train = [leg.serviceType, leg.trainName || leg.trainNumber]
    .filter(Boolean)
    .join(" ");
  return `${formatClock(leg.departureTimeMinutes)}発の${train}へ変更しました。変更後の経路です。`;
}

function referencedLeg(
  prompt: string,
  plan: ViewerAgentJourneyPlan,
): { journeyIndex: number; legIndex: number } | undefined {
  const requestedJourney = /候補([1-3])/u.exec(prompt)?.[1];
  const journeyIndex = requestedJourney ? Number(requestedJourney) - 1 : 0;
  const journey = plan.journeys[journeyIndex];
  if (!journey) {
    return undefined;
  }
  const scored = journey.legs
    .map((leg, legIndex) => ({
      legIndex,
      score:
        Number(prompt.includes(normalizeStation(leg.originStation))) +
        Number(prompt.includes(normalizeStation(leg.destinationStation))),
    }))
    .sort((left, right) => right.score - left.score);
  if ((scored[0]?.score ?? 0) > 0) {
    return { journeyIndex, legIndex: scored[0].legIndex };
  }
  return journey.legs.length === 1 ? { journeyIndex, legIndex: 0 } : undefined;
}

function confirmedAlternativeIndex(
  prompt: string,
  pending: PendingJourneyLegChange,
): number | undefined {
  const numbered = /(?:候補)?([1-5])番/u.exec(prompt)?.[1];
  if (numbered) {
    const index = Number(numbered) - 1;
    return pending.alternatives[index] ? index : undefined;
  }
  const named = pending.alternatives.findIndex((leg) =>
    [leg.trainNumber, leg.trainName]
      .filter(Boolean)
      .some((value) => prompt.includes(normalize(value))),
  );
  if (named >= 0) {
    return named;
  }
  if (
    pending.alternatives.length === 1 &&
    /(それ|これ|決定|変更して|お願いします)/u.test(prompt)
  ) {
    return 0;
  }
  return undefined;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "");
}

function normalizeStation(value: string): string {
  return normalize(value).replace(/駅$/u, "");
}

function stationLabel(value: string): string {
  return `${value.replace(/駅$/u, "")}駅`;
}

function formatClock(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
