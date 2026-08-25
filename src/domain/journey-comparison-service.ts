import type {
  JourneySearchLeg,
  JourneySearchResponse,
} from "./journey-search-service";

export type JourneyConstraintKind =
  | "departure_after_search_time"
  | "maximum_transfers"
  | "required_service_type"
  | "required_train_name"
  | "required_train_number"
  | "allowed_service_types"
  | "excluded_service_type"
  | "excluded_train_name"
  | "excluded_train_number"
  | "excluded_service_uid";

export interface JourneyConstraintEvaluation {
  kind: JourneyConstraintKind;
  expected: string | number | string[];
  actual: string | number | string[];
  satisfied: boolean;
}

export type JourneyComparisonReason =
  | "earliest_arrival"
  | "latest_departure"
  | "shortest_duration"
  | "fewest_transfers"
  | "least_applied_delay"
  | "all_constraints_satisfied";

export interface ComparedJourney {
  candidateId: string;
  sourceIndex: number;
  departureTimeMinutes: number;
  arrivalTimeMinutes: number;
  durationMinutes: number;
  transferCount: number;
  delay: {
    delayedLegCount: number;
    observedLegCount: number;
    estimatedLegCount: number;
    totalAppliedDelayMinutes: number;
    maximumAppliedDelayMinutes: number;
  };
  constraintsSatisfied: boolean;
  constraintEvaluations: JourneyConstraintEvaluation[];
  advantages: JourneyComparisonReason[];
}

export interface JourneyComparison {
  serviceDate: string;
  originStation: string;
  destinationStation: string;
  rankingPreference: JourneySearchResponse["rankingPreference"];
  recommendedCandidateId: string | null;
  candidates: ComparedJourney[];
  source: "verified-journey-search-result";
}

export interface JourneyComparisonRequest {
  journeyIndexes?: number[];
}

export function compareJourneySearchResult(
  result: JourneySearchResponse,
  request: JourneyComparisonRequest = {},
): JourneyComparison {
  const indexes = request.journeyIndexes ?? result.journeys.map((_, index) => index);
  const candidates = indexes.map((sourceIndex) => {
    const journey = result.journeys[sourceIndex];
    if (!journey) {
      throw new RangeError(`経路候補${sourceIndex + 1}は検索結果に存在しません`);
    }
    const delayMinutes = journey.legs.map((leg) => nonNegative(leg.delayMinutes));
    const constraintEvaluations = evaluateConstraints(result, journey.legs, {
      departureTimeMinutes: journey.departureTimeMinutes,
      transferCount: journey.transferCount,
    });
    return {
      candidateId: `journey-${sourceIndex + 1}`,
      sourceIndex,
      departureTimeMinutes: journey.departureTimeMinutes,
      arrivalTimeMinutes: journey.arrivalTimeMinutes,
      durationMinutes: Math.max(
        0,
        journey.arrivalTimeMinutes - journey.departureTimeMinutes,
      ),
      transferCount: journey.transferCount,
      delay: {
        delayedLegCount: delayMinutes.filter((delay) => delay > 0).length,
        observedLegCount: journey.legs.filter((leg) =>
          leg.delayStatus === "observed").length,
        estimatedLegCount: journey.legs.filter((leg) =>
          leg.delayStatus === "estimated").length,
        totalAppliedDelayMinutes: sum(delayMinutes),
        maximumAppliedDelayMinutes: Math.max(0, ...delayMinutes),
      },
      constraintsSatisfied: constraintEvaluations.every(({ satisfied }) => satisfied),
      constraintEvaluations,
      advantages: [] as JourneyComparisonReason[],
    } satisfies ComparedJourney;
  });

  const eligible = candidates.filter(({ constraintsSatisfied }) => constraintsSatisfied);
  const comparisonPool = eligible.length > 0 ? eligible : candidates;
  const recommended = [...comparisonPool].sort((left, right) =>
    compareByPreference(left, right, result.rankingPreference))[0];
  const extrema = extremaFor(candidates);
  for (const candidate of candidates) {
    candidate.advantages = reasonsFor(candidate, extrema);
  }

  return {
    serviceDate: result.serviceDate,
    originStation: result.originStation,
    destinationStation: result.destinationStation,
    rankingPreference: result.rankingPreference,
    recommendedCandidateId: recommended?.candidateId ?? null,
    candidates,
    source: "verified-journey-search-result",
  };
}

function evaluateConstraints(
  result: JourneySearchResponse,
  legs: JourneySearchLeg[],
  summary: { departureTimeMinutes: number; transferCount: number },
): JourneyConstraintEvaluation[] {
  const evaluations: JourneyConstraintEvaluation[] = [{
    kind: "departure_after_search_time",
    expected: result.searchTimeMinutes,
    actual: summary.departureTimeMinutes,
    satisfied: summary.departureTimeMinutes >= result.searchTimeMinutes,
  }];
  if (result.maxTransfers !== undefined) {
    evaluations.push({
      kind: "maximum_transfers",
      expected: result.maxTransfers,
      actual: summary.transferCount,
      satisfied: summary.transferCount <= result.maxTransfers,
    });
  }
  for (const required of result.requiredServiceTypes ?? []) {
    evaluations.push(requiredValue("required_service_type", required, legs, "serviceType"));
  }
  for (const required of result.requiredTrainNames ?? []) {
    evaluations.push(requiredValue("required_train_name", required, legs, "trainName", true));
  }
  for (const required of result.requiredTrainNumbers ?? []) {
    evaluations.push(requiredValue("required_train_number", required, legs, "trainNumber"));
  }
  if ((result.allowedServiceTypes?.length ?? 0) > 0) {
    const actual = legs.map(({ serviceType }) => serviceType);
    evaluations.push({
      kind: "allowed_service_types",
      expected: result.allowedServiceTypes ?? [],
      actual,
      satisfied: actual.every((value) =>
        includesNormalized(result.allowedServiceTypes ?? [], value)),
    });
  }
  for (const excluded of result.excludedServiceTypes ?? []) {
    evaluations.push(excludedValue("excluded_service_type", excluded, legs, "serviceType"));
  }
  for (const excluded of result.excludedTrainNames ?? []) {
    evaluations.push(excludedValue("excluded_train_name", excluded, legs, "trainName", true));
  }
  for (const excluded of result.excludedTrainNumbers ?? []) {
    evaluations.push(excludedValue("excluded_train_number", excluded, legs, "trainNumber"));
  }
  for (const excluded of result.excludedServiceUids ?? []) {
    evaluations.push(excludedValue("excluded_service_uid", excluded, legs, "serviceUid"));
  }
  return evaluations;
}

function requiredValue(
  kind: JourneyConstraintKind,
  expected: string,
  legs: JourneySearchLeg[],
  field: "serviceType" | "trainName" | "trainNumber",
  partial = false,
): JourneyConstraintEvaluation {
  const actual = legs.map((leg) => leg[field]);
  return {
    kind,
    expected,
    actual,
    satisfied: actual.some((value) => matches(value, expected, partial)),
  };
}

function excludedValue(
  kind: JourneyConstraintKind,
  expected: string,
  legs: JourneySearchLeg[],
  field: "serviceType" | "trainName" | "trainNumber" | "serviceUid",
  partial = false,
): JourneyConstraintEvaluation {
  const actual = legs.map((leg) => leg[field]);
  return {
    kind,
    expected,
    actual,
    satisfied: actual.every((value) => !matches(value, expected, partial)),
  };
}

function compareByPreference(
  left: ComparedJourney,
  right: ComparedJourney,
  preference: JourneySearchResponse["rankingPreference"],
): number {
  if (preference === "latest-departure") {
    return right.departureTimeMinutes - left.departureTimeMinutes || stableFallback(left, right);
  }
  if (preference === "fewest-transfers") {
    return left.transferCount - right.transferCount || stableFallback(left, right);
  }
  if (preference === "earliest-arrival") {
    return left.arrivalTimeMinutes - right.arrivalTimeMinutes || stableFallback(left, right);
  }
  return (
    left.arrivalTimeMinutes + left.transferCount * 10 -
      (right.arrivalTimeMinutes + right.transferCount * 10) ||
    stableFallback(left, right)
  );
}

function stableFallback(left: ComparedJourney, right: ComparedJourney): number {
  return left.durationMinutes - right.durationMinutes ||
    left.delay.totalAppliedDelayMinutes - right.delay.totalAppliedDelayMinutes ||
    left.sourceIndex - right.sourceIndex;
}

function extremaFor(candidates: ComparedJourney[]) {
  return {
    earliestArrival: Math.min(...candidates.map((item) => item.arrivalTimeMinutes)),
    latestDeparture: Math.max(...candidates.map((item) => item.departureTimeMinutes)),
    shortestDuration: Math.min(...candidates.map((item) => item.durationMinutes)),
    fewestTransfers: Math.min(...candidates.map((item) => item.transferCount)),
    leastDelay: Math.min(...candidates.map((item) => item.delay.totalAppliedDelayMinutes)),
  };
}

function reasonsFor(
  candidate: ComparedJourney,
  extrema: ReturnType<typeof extremaFor>,
): JourneyComparisonReason[] {
  const reasons: JourneyComparisonReason[] = [];
  if (candidate.arrivalTimeMinutes === extrema.earliestArrival) reasons.push("earliest_arrival");
  if (candidate.departureTimeMinutes === extrema.latestDeparture) reasons.push("latest_departure");
  if (candidate.durationMinutes === extrema.shortestDuration) reasons.push("shortest_duration");
  if (candidate.transferCount === extrema.fewestTransfers) reasons.push("fewest_transfers");
  if (candidate.delay.totalAppliedDelayMinutes === extrema.leastDelay) reasons.push("least_applied_delay");
  if (candidate.constraintsSatisfied) reasons.push("all_constraints_satisfied");
  return reasons;
}

function includesNormalized(values: string[], target: string): boolean {
  return values.some((value) => matches(value, target, false));
}

function matches(actual: string, expected: string, partial: boolean): boolean {
  const normalizedActual = normalize(actual);
  const normalizedExpected = normalize(expected);
  return partial
    ? normalizedActual.includes(normalizedExpected)
    : normalizedActual === normalizedExpected;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("ja");
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
