import type { Train } from "../data/train-index";
import type { TrainPosition } from "./train-position";
import type { ViewerAgentAction } from "./viewer-agent-action";

export interface ViewerTrainSearchResult {
  train: Train;
  position: TrainPosition;
}

export interface ViewerTrainSearchResponse {
  hasSearchTerms: boolean;
  matches: ViewerTrainSearchResult[];
  totalMatchCount: number;
}

export interface ViewerTrainArrivalResult {
  train: Train;
  stationName: string;
  arrivalTimeMinutes: number;
}

export interface ViewerTrainArrivalResponse {
  hasSearchTerms: boolean;
  matches: ViewerTrainArrivalResult[];
  totalMatchCount: number;
  targetTimeMinutes?: number;
  windowMinutes: number;
}

const serviceTypeKeywords = ["新快速", "新幹線", "特急", "快速", "普通"];
export const arrivalSearchWindowMinutes = 30;

export function routeTimeFromPrompt(prompt: string): number | undefined {
  const normalizedPrompt = normalize(prompt);
  const colonTime = normalizedPrompt.match(
    /(?:^|\D)(\d{1,2}):(\d{1,2})(?:\D|$)/,
  );
  if (colonTime) {
    return validRouteTime(Number(colonTime[1]), Number(colonTime[2]));
  }

  const japaneseTime = normalizedPrompt.match(
    /(\d{1,2})時(?:(\d{1,2})分)?/,
  );
  if (japaneseTime) {
    return validRouteTime(
      Number(japaneseTime[1]),
      Number(japaneseTime[2] ?? 0),
    );
  }

  return undefined;
}

export function searchActiveTrainsFromPrompt(
  prompt: string,
  trains: Train[],
  positions: TrainPosition[],
  routeTimeMinutes: number,
  limit = 5,
): ViewerTrainSearchResponse {
  const normalizedPrompt = normalize(prompt);
  const activePositions = new Map(
    positions.map((position) => [position.serviceUid, position]),
  );
  const stationNames = longestMentionedValues(
    normalizedPrompt,
    trains.flatMap((train) => [
      train.destination_station,
      ...train.stops.flatMap(({ station_name }) =>
        station_name ? [station_name] : [],
      ),
    ]),
  );
  const trainNames = longestMentionedValues(
    normalizedPrompt,
    trains.flatMap((train) => {
      const name = trainNameKeyword(train.train_name);
      return name ? [name] : [];
    }),
  );
  const trainNumbers = new Set(
    trains
      .map(({ train_no }) => normalize(train_no))
      .filter(
        (trainNumber) =>
          trainNumber.length >= 2 && normalizedPrompt.includes(trainNumber),
      ),
  );
  const serviceTypes = new Set(
    serviceTypeKeywords.filter((keyword) =>
      normalizedPrompt.includes(normalize(keyword)),
    ),
  );
  const hasSearchTerms =
    stationNames.size > 0 ||
    trainNames.size > 0 ||
    trainNumbers.size > 0 ||
    serviceTypes.size > 0;

  if (!hasSearchTerms) {
    return { hasSearchTerms: false, matches: [], totalMatchCount: 0 };
  }

  const rankedMatches = trains
    .flatMap((train) => {
      const position = activePositions.get(train.service_uid);
      if (!position) {
        return [];
      }

      const score = scoreTrain(
        train,
        stationNames,
        trainNames,
        trainNumbers,
        serviceTypes,
        routeTimeMinutes,
      );
      return score === undefined ? [] : [{ train, position, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.train.train_no.localeCompare(right.train.train_no, "ja"),
    );
  const matches = rankedMatches
    .slice(0, Math.max(1, limit))
    .map(({ train, position }) => ({ train, position }));

  return {
    hasSearchTerms,
    matches,
    totalMatchCount: rankedMatches.length,
  };
}

export function searchTrainArrivalsFromPrompt(
  prompt: string,
  trains: Train[],
  limit = 5,
  windowMinutes = arrivalSearchWindowMinutes,
  requestedTargetTime?: number,
): ViewerTrainArrivalResponse {
  const normalizedPrompt = normalize(prompt);
  const targetTimeMinutes =
    routeTimeFromPrompt(prompt) ?? requestedTargetTime;
  const stationNames = longestMentionedValues(
    normalizedPrompt,
    trains.flatMap((train) =>
      train.stops.flatMap(({ station_name }) =>
        station_name ? [station_name] : [],
      ),
    ),
  );
  const serviceTypes = new Set(
    serviceTypeKeywords.filter((keyword) =>
      normalizedPrompt.includes(normalize(keyword)),
    ),
  );
  const trainNames = longestMentionedValues(
    normalizedPrompt,
    trains.flatMap((train) => {
      const name = trainNameKeyword(train.train_name);
      return name ? [name] : [];
    }),
  );
  const trainNumbers = new Set(
    trains
      .map(({ train_no }) => normalize(train_no))
      .filter(
        (trainNumber) =>
          trainNumber.length >= 2 && normalizedPrompt.includes(trainNumber),
      ),
  );
  const hasSearchTerms =
    isArrivalPrompt(normalizedPrompt) &&
    targetTimeMinutes !== undefined &&
    stationNames.size > 0;

  if (!hasSearchTerms || targetTimeMinutes === undefined) {
    return {
      hasSearchTerms: false,
      matches: [],
      totalMatchCount: 0,
      windowMinutes,
    };
  }

  const rankedMatches = trains
    .flatMap((train) => {
      if (
        serviceTypes.size > 0 &&
        !Array.from(serviceTypes).some((keyword) =>
          normalize(train.service_type).includes(normalize(keyword)),
        )
      ) {
        return [];
      }
      if (
        trainNames.size > 0 &&
        !trainNames.has(normalize(trainNameKeyword(train.train_name)))
      ) {
        return [];
      }
      if (
        trainNumbers.size > 0 &&
        !trainNumbers.has(normalize(train.train_no))
      ) {
        return [];
      }

      const arrival = train.stops.find(
        ({ event, station_name, route_time_minutes }) =>
          event?.includes("着") === true &&
          station_name !== undefined &&
          stationNames.has(normalize(station_name)) &&
          route_time_minutes !== undefined &&
          Math.abs(route_time_minutes - targetTimeMinutes) <= windowMinutes,
      );
      if (
        !arrival?.station_name ||
        arrival.route_time_minutes === undefined
      ) {
        return [];
      }
      return [
        {
          train,
          stationName: arrival.station_name,
          arrivalTimeMinutes: arrival.route_time_minutes,
          difference: Math.abs(
            arrival.route_time_minutes - targetTimeMinutes,
          ),
        },
      ];
    })
    .sort(
      (left, right) =>
        left.difference - right.difference ||
        left.arrivalTimeMinutes - right.arrivalTimeMinutes ||
        left.train.train_no.localeCompare(right.train.train_no, "ja"),
    );

  return {
    hasSearchTerms: true,
    matches: rankedMatches
      .slice(0, Math.max(1, limit))
      .map(({ difference: _, ...match }) => match),
    totalMatchCount: rankedMatches.length,
    targetTimeMinutes,
    windowMinutes,
  };
}

export function localViewerControlActionsFromPrompt(
  prompt: string,
): ViewerAgentAction[] {
  const normalizedPrompt = normalize(prompt);
  const actions: ViewerAgentAction[] = [];

  if (normalizedPrompt.includes("雨")) {
    actions.push({ type: "set_weather", weather: "rain" });
  } else if (normalizedPrompt.includes("雪")) {
    actions.push({ type: "set_weather", weather: "snow" });
  } else if (normalizedPrompt.includes("晴")) {
    actions.push({ type: "set_weather", weather: "clear" });
  }

  if (normalizedPrompt.includes("模型")) {
    actions.push({ type: "set_scene_mode", sceneMode: "model" });
  } else if (normalizedPrompt.includes("通常")) {
    actions.push({ type: "set_scene_mode", sceneMode: "normal" });
  }

  const visible = requestedLayerVisibility(normalizedPrompt);
  if (visible !== undefined && normalizedPrompt.includes("混雑")) {
    actions.push({
      type: "set_layer_visibility",
      layer: "congestion",
      visible,
    });
  }
  if (
    visible !== undefined &&
    (normalizedPrompt.includes("目的地アーチ") ||
      normalizedPrompt.includes("行先アーチ") ||
      normalizedPrompt.includes("行き先アーチ"))
  ) {
    actions.push({
      type: "set_layer_visibility",
      layer: "destination_arcs",
      visible,
    });
  }

  return actions;
}

function scoreTrain(
  train: Train,
  stationNames: Set<string>,
  trainNames: Set<string>,
  trainNumbers: Set<string>,
  serviceTypes: Set<string>,
  routeTimeMinutes: number,
): number | undefined {
  const normalizedTrainNumber = normalize(train.train_no);
  const normalizedTrainName = normalize(trainNameKeyword(train.train_name));
  const normalizedServiceType = normalize(train.service_type);
  const normalizedDestination = normalize(train.destination_station);
  let score = 0;

  if (
    trainNumbers.size > 0 &&
    !trainNumbers.has(normalizedTrainNumber)
  ) {
    return undefined;
  }
  if (trainNumbers.size > 0) {
    score += 1_000;
  }

  if (trainNames.size > 0 && !trainNames.has(normalizedTrainName)) {
    return undefined;
  }
  if (trainNames.size > 0) {
    score += 500;
  }

  if (
    serviceTypes.size > 0 &&
    !Array.from(serviceTypes).some((keyword) =>
      normalizedServiceType.includes(normalize(keyword)),
    )
  ) {
    return undefined;
  }
  if (serviceTypes.size > 0) {
    score += 50;
  }

  if (stationNames.size > 0) {
    const destinationMatch = stationNames.has(normalizedDestination);
    const remainingStopMatch = train.stops.some(
      ({ station_name, route_time_minutes }) =>
        station_name !== undefined &&
        stationNames.has(normalize(station_name)) &&
        (route_time_minutes === undefined ||
          route_time_minutes >= routeTimeMinutes),
    );
    if (!destinationMatch && !remainingStopMatch) {
      return undefined;
    }
    score += destinationMatch ? 200 : 100;
  }

  return score;
}

function longestMentionedValues(
  normalizedPrompt: string,
  rawValues: string[],
): Set<string> {
  const mentioned = new Set(
    rawValues
      .map(normalize)
      .filter(
        (value) =>
          value.length >= 2 && normalizedPrompt.includes(value),
      ),
  );
  const longestLength = Math.max(
    0,
    ...Array.from(mentioned, (value) => value.length),
  );
  return new Set(
    Array.from(mentioned).filter((value) => value.length === longestLength),
  );
}

function trainNameKeyword(trainName: string): string {
  return trainName.replace(/\s*\d+号?$/u, "").trim();
}

function isArrivalPrompt(normalizedPrompt: string): boolean {
  return (
    normalizedPrompt.includes("到着") ||
    normalizedPrompt.includes("着く") ||
    normalizedPrompt.includes("着き") ||
    normalizedPrompt.includes("着け") ||
    normalizedPrompt.includes("につく")
  );
}

function requestedLayerVisibility(
  normalizedPrompt: string,
): boolean | undefined {
  if (
    normalizedPrompt.includes("非表示") ||
    normalizedPrompt.includes("消して") ||
    normalizedPrompt.includes("隠して") ||
    normalizedPrompt.includes("オフ")
  ) {
    return false;
  }
  if (
    normalizedPrompt.includes("表示") ||
    normalizedPrompt.includes("見せて") ||
    normalizedPrompt.includes("出して") ||
    normalizedPrompt.includes("オン")
  ) {
    return true;
  }
  return undefined;
}

function validRouteTime(
  hours: number,
  minutes: number,
): number | undefined {
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 47 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return undefined;
  }
  return hours * 60 + minutes;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja");
}
