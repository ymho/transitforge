import type {
  JourneyRouteLeg,
  JourneyRouteResult,
} from "@raiquora/journey/direct-route-search";
import type { ViewerAgentJourneyPlan } from "./viewer-agent-response";
import { formatRouteClockTime } from "@raiquora/train/route-time";
import { formatStationLabel } from "@raiquora/train/station-name";

export interface PendingJourneyLegChange {
  plan: ViewerAgentJourneyPlan;
  journeyIndex: number;
  legIndex: number;
  endLegIndex?: number;
  alternatives: JourneyRouteLeg[];
}

export type JourneyLegAlternativeSearch = (request: {
  plan: ViewerAgentJourneyPlan;
  journey: JourneyRouteResult;
  startLegIndex: number;
  endLegIndex: number;
  requiredServiceTypes: string[];
}) => Promise<JourneyRouteLeg[]>;

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
    return `${formatStationLabel(leg.originStation)}から${formatStationLabel(leg.destinationStation)}までに途中停車駅はありません。`;
  }
  const values = stops.map((stop) => {
    const time = stop.departureTimeMinutes ?? stop.arrivalTimeMinutes;
    return time === undefined
      ? formatStationLabel(stop.stationName)
      : `${formatRouteClockTime(time)} ${formatStationLabel(stop.stationName)}`;
  });
  return `${formatStationLabel(leg.originStation)}から${formatStationLabel(leg.destinationStation)}までの途中停車駅は ${values.join(" → ")} です。`;
}

export function alternativeProposalResponse(
  current: JourneyRouteLeg,
  alternatives: JourneyRouteLeg[],
): string {
  if (alternatives.length === 0) {
    return `${formatStationLabel(current.originStation)}から${formatStationLabel(current.destinationStation)}までで変更できる列車は見つかりませんでした。`;
  }
  const options = alternatives.map((leg, index) => {
    const train = [leg.serviceType, leg.trainName || leg.trainNumber]
      .filter(Boolean)
      .join(" ");
    return `${index + 1}. ${formatRouteClockTime(leg.departureTimeMinutes)} → ${formatRouteClockTime(leg.arrivalTimeMinutes)} ${train}`;
  });
  return [
    `${formatStationLabel(current.originStation)}から${formatStationLabel(current.destinationStation)}までの別の列車です。まだ経路は変更していません。`,
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
  const endLegIndex = pending.endLegIndex ?? pending.legIndex;
  const replacedLegs = [
    ...selectedJourney.legs.slice(0, pending.legIndex),
    alternative,
    ...selectedJourney.legs.slice(endLegIndex + 1),
  ];
  const journey = {
    ...selectedJourney,
    legs: replacedLegs,
    transferCount: Math.max(0, replacedLegs.length - 1),
    departureTimeMinutes: replacedLegs[0]?.departureTimeMinutes ?? selectedJourney.departureTimeMinutes,
    arrivalTimeMinutes:
      replacedLegs.at(-1)?.arrivalTimeMinutes ?? selectedJourney.arrivalTimeMinutes,
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
  return `${formatRouteClockTime(leg.departureTimeMinutes)}発の${train}へ変更しました。変更後の経路です。`;
}
