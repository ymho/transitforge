import type { Train } from "@raiquora/train/train";
import type { TrainPosition } from "../../domain/train-position";
import type { ViewerAgentAction } from "./viewer-action";
import { operatingDayRouteTime } from "../../domain/playback";
import { normalizeStationName } from "@raiquora/train/station-name";

export { formatStationLabel } from "@raiquora/train/station-name";

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

export interface DirectRoutePromptRequest {
  originStation?: string;
  destinationStation: string;
  departureTimeMinutes?: number;
}

export interface RouteCalendarDate {
  departureDate: string;
  serviceDate: string;
}

const serviceTypeKeywords = ["新快速", "新幹線", "特急", "快速", "普通"];
export const arrivalSearchWindowMinutes = 30;

/**
 * モデルが駅名未指定を表すために出力する値は、経路検索の出発駅として扱わない。
 * 実在の駅名は利用者の入力または端末内の最寄り駅選択だけを正本にする。
 */
export function isUsableOriginStation(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  return Boolean(candidate) && !/(?:&quot;|&lt;|&gt;|<\/?[a-z]+>|省略|現在地から最寄り駅)/iu.test(candidate);
}

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

  if (/(?:早朝|朝一番)(?:に|から|出発|発|ごろ)/u.test(normalizedPrompt)) return 6 * 60;
  if (/(?:朝|午前中)(?:に|から|出発|発|ごろ)/u.test(normalizedPrompt)) return 8 * 60;
  if (/(?:昼|正午)(?:に|から|出発|発|ごろ)/u.test(normalizedPrompt)) return 12 * 60;
  if (/(?:夕方)(?:に|から|出発|発|ごろ)/u.test(normalizedPrompt)) return 17 * 60;
  if (/(?:夜|晩)(?:に|から|出発|発|ごろ)/u.test(normalizedPrompt)) return 19 * 60;

  return undefined;
}

export function routeCalendarDateFromPrompt(
  prompt: string,
  departureTimeMinutes: number,
  now = new Date(),
): RouteCalendarDate | undefined {
  const departureDate = calendarDateFromPrompt(prompt, now);
  if (!departureDate) {
    return undefined;
  }
  return {
    departureDate,
    serviceDate: departureTimeMinutes >= 24 * 60
      ? stepIsoDate(departureDate, -1)
      : departureDate,
  };
}

export function currentCalendarDateInJapan(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function calendarDateFromPrompt(prompt: string, now: Date): string | undefined {
  const normalizedPrompt = normalize(prompt);
  const referenceDate = currentCalendarDateInJapan(now);
  if (normalizedPrompt.includes("明後日")) {
    return stepIsoDate(referenceDate, 2);
  }
  if (normalizedPrompt.includes("明日")) {
    return stepIsoDate(referenceDate, 1);
  }
  if (normalizedPrompt.includes("今日") || normalizedPrompt.includes("本日")) {
    return referenceDate;
  }

  const fullDate = normalizedPrompt.match(
    /(\d{4})(?:年|[\/-])(\d{1,2})(?:月|[\/-])(\d{1,2})日?/,
  );
  if (fullDate) {
    return validIsoDate(
      Number(fullDate[1]),
      Number(fullDate[2]),
      Number(fullDate[3]),
    );
  }

  const monthDay = normalizedPrompt.match(
    /(?:^|\D)(\d{1,2})(?:月|\/)(\d{1,2})日?/,
  );
  if (!monthDay) {
    return referenceDate;
  }
  const month = Number(monthDay[1]);
  const day = Number(monthDay[2]);
  const referenceYear = Number(referenceDate.slice(0, 4));
  const referenceTime = Date.parse(`${referenceDate}T00:00:00Z`);
  return [referenceYear - 1, referenceYear, referenceYear + 1]
    .flatMap((year) => {
      const date = validIsoDate(year, month, day);
      return date
        ? [{
            date,
            distance: Math.abs(
              Date.parse(`${date}T00:00:00Z`) - referenceTime,
            ),
          }]
        : [];
    })
    .sort((left, right) =>
      left.distance - right.distance || left.date.localeCompare(right.date),
    )[0]?.date;
}

function validIsoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function stepIsoDate(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function directRouteRequestFromPrompt(
  prompt: string,
  trains: Train[],
): DirectRoutePromptRequest | undefined {
  const normalizedPrompt = normalize(prompt);
  const hasRouteIntent =
    normalizedPrompt.includes("行きたい") ||
    normalizedPrompt.includes("いきたい") ||
    normalizedPrompt.includes("行き方") ||
    normalizedPrompt.includes("経路") ||
    normalizedPrompt.includes("直通") ||
    normalizedPrompt.includes("乗り換えなし") ||
    normalizedPrompt.includes("から") ||
    normalizedPrompt.endsWith("へ") ||
    normalizedPrompt.endsWith("まで");
  if (!hasRouteIntent) {
    return undefined;
  }

  const stationByNormalizedName = new Map<string, string>();
  for (const train of trains) {
    for (const stationName of [
      train.origin_station,
      train.destination_station,
      ...train.stops.flatMap(({ station_name }) =>
        station_name ? [station_name] : [],
      ),
    ]) {
      const normalizedName = normalizeStationName(stationName);
      if (
        normalizedName.length >= 2 &&
        !stationByNormalizedName.has(normalizedName)
      ) {
        stationByNormalizedName.set(
          normalizedName,
          stationName.replace(/駅$/u, ""),
        );
      }
    }
  }

  const mentions = Array.from(stationByNormalizedName)
    .flatMap(([normalizedName, stationName]) => {
      const index = normalizedPrompt.indexOf(normalizedName);
      return index < 0 ? [] : [{ index, normalizedName, stationName }];
    })
    .filter(
      (candidate, _, all) =>
        !all.some(
          (other) =>
            other.index === candidate.index &&
            other.normalizedName.length > candidate.normalizedName.length,
        ),
    )
    .sort((left, right) => left.index - right.index);
  if (mentions.length === 0) {
    return undefined;
  }

  const fromIndex = Array.from(normalizedPrompt.matchAll(/から/gu))
    .map((match) => match.index)
    .filter((separatorIndex) =>
      mentions.some(({ index, normalizedName }) =>
        index + normalizedName.length <= separatorIndex
      ) && mentions.some(({ index }) => index > separatorIndex)
    )
    .at(-1) ?? -1;
  const origin =
    fromIndex < 0
      ? undefined
      : mentions.filter(({ index }) => index < fromIndex).at(-1);
  const destination =
    fromIndex < 0
      ? mentions.at(-1)
      : mentions.find(({ index }) => index > fromIndex);
  if (!destination || destination.stationName === origin?.stationName) {
    return undefined;
  }

  const departureTimeMinutes = routeTimeFromPrompt(prompt);
  return {
    ...(origin ? { originStation: origin.stationName } : {}),
    destinationStation: destination.stationName,
    ...(departureTimeMinutes === undefined ? {} : { departureTimeMinutes }),
  };
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
  } else if (
    normalizedPrompt.includes("曇") ||
    normalizedPrompt.includes("雲")
  ) {
    actions.push({ type: "set_weather", weather: "cloudy" });
  } else if (normalizedPrompt.includes("晴")) {
    actions.push({ type: "set_weather", weather: "clear" });
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
  return operatingDayRouteTime(hours * 60 + minutes);
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja");
}
