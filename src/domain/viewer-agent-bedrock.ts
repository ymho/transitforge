import type {
  BedrockAgentContentBlock,
  BedrockAgentMessage,
  BedrockAgentResponse,
  BedrockAgentToolResultBlock,
  RepresentativeTimetableSearchMode,
  RepresentativeTimetableSearchResponse,
  RepresentativeTimetableKind,
} from "../data/bedrock-agent";
import type { Train } from "../data/train-index";
import type { CongestionAnalysisForAgent } from "./congestion-analysis";
import type { DelayAnalysisForAgent } from "./delay-analysis";
import type { WeatherMode } from "./map-weather";
import { operatingDayRouteTime } from "./playback";
import type { TrainPosition } from "./train-position";
import type { RouteSearchResponse } from "../presentation/route-search-panel";
import {
  parseViewerAgentActions,
  type ViewerAgentLayer,
} from "./viewer-agent-action";
import {
  arrivalSearchWindowMinutes,
  routeTimeFromPrompt,
  searchActiveTrainsFromPrompt,
  searchTrainArrivalsFromPrompt,
} from "./viewer-agent-local-tools";

export interface BedrockViewerAgentDependencies {
  trains: Train[];
  getPositions: () => TrainPosition[];
  getRouteTime: () => number;
  setRouteTime: (routeTimeMinutes: number) => void;
  focusTrain: (serviceUid: string) => boolean;
  setWeather: (weather: WeatherMode) => void;
  setLayerVisibility: (layer: ViewerAgentLayer, visible: boolean) => void;
  queryDailyCongestionAnalysis: (
    serviceDate: string,
  ) => Promise<CongestionAnalysisForAgent>;
  queryTrainDelayAnalysis: (
    serviceDate: string,
  ) => Promise<DelayAnalysisForAgent>;
  searchRepresentativeTimetable?: (request: {
    timetableKind: RepresentativeTimetableKind;
    query: string;
    mode: RepresentativeTimetableSearchMode;
    targetTimeMinutes?: number;
    limit?: number;
  }) => Promise<RepresentativeTimetableSearchResponse>;
  searchDirectRoutes?: (request: {
    originStation?: string;
    destinationStation: string;
    departureTimeMinutes: number;
  }) => Promise<RouteSearchResponse>;
  maximumRouteTime: number;
}

export type BedrockAgentConverse = (
  messages: BedrockAgentMessage[],
) => Promise<BedrockAgentResponse>;

const maximumToolRounds = 6;

export async function runBedrockViewerAgent(
  prompt: string,
  dependencies: BedrockViewerAgentDependencies,
  converse: BedrockAgentConverse,
): Promise<string> {
  const messages: BedrockAgentMessage[] = [
    {
      role: "user",
      content: [
        {
          text:
            `利用者の依頼: ${prompt}\n` +
            `現在の表示時刻（0時からの分数）: ${dependencies.getRouteTime()}\n` +
            `日本時間の今日の日付: ${currentDateInJapan()}`,
        },
      ],
    },
  ];
  const searchableServiceUids = new Set<string>();
  const directRouteServiceUids = new Set<string>();

  for (let round = 0; round < maximumToolRounds; round += 1) {
    const response = await converse(messages);
    messages.push(response.message);
    const toolUses = response.message.content.filter(isToolUseBlock);

    if (toolUses.length === 0) {
      const text = response.message.content
        .filter(isTextBlock)
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n");
      return text || "案内を完了しました。";
    }

    const toolResults: BedrockAgentToolResultBlock[] = [];
    for (const { toolUse } of toolUses) {
      try {
        const result = await executeTool(
          toolUse.name,
          toolUse.input,
          prompt,
          dependencies,
          searchableServiceUids,
          directRouteServiceUids,
        );
        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId,
            status: "success",
            content: [{ json: result }],
          },
        });
      } catch (error) {
        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId,
            status: "error",
            content: [
              {
                json: {
                  message:
                    error instanceof Error
                      ? error.message
                      : "ツールを実行できませんでした。",
                },
              },
            ],
          },
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("AIの画面操作回数が上限を超えました。");
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  originalPrompt: string,
  dependencies: BedrockViewerAgentDependencies,
  searchableServiceUids: Set<string>,
  directRouteServiceUids: Set<string>,
): Promise<unknown> {
  if (name === "set_display_time") {
    const requestedTime = input.routeTimeMinutes;
    if (typeof requestedTime !== "number" || !Number.isFinite(requestedTime)) {
      throw new Error("表示時刻が不正です。");
    }
    const deterministicPromptTime = routeTimeFromPrompt(originalPrompt);
    const routeTimeMinutes = Math.min(
      Math.round(
        deterministicPromptTime ?? operatingDayRouteTime(requestedTime),
      ),
      dependencies.maximumRouteTime,
    );
    const [action] = parseViewerAgentActions([
      { type: "set_display_time", routeTimeMinutes },
    ]);
    if (!action || action.type !== "set_display_time") {
      throw new Error("表示時刻を変更できません。");
    }
    dependencies.setRouteTime(action.routeTimeMinutes);
    searchableServiceUids.clear();
    return { routeTimeMinutes: action.routeTimeMinutes };
  }

  if (name === "search_trains") {
    const query = input.query;
    if (typeof query !== "string" || query.trim().length === 0) {
      throw new Error("列車の検索条件が必要です。");
    }
    const requestedLimit =
      typeof input.limit === "number" && Number.isInteger(input.limit)
        ? input.limit
        : 5;
    const limit = Math.max(1, Math.min(5, requestedLimit));
    const search = searchActiveTrainsFromPrompt(
      query,
      dependencies.trains,
      dependencies.getPositions(),
      dependencies.getRouteTime(),
      limit,
    );
    for (const { train } of search.matches) {
      searchableServiceUids.add(train.service_uid);
    }
    return {
      hasSearchTerms: search.hasSearchTerms,
      totalMatchCount: search.totalMatchCount,
      matches: search.matches.map(({ train }) => ({
        serviceUid: train.service_uid,
        trainNumber: train.train_no,
        serviceType: train.service_type,
        trainName: train.train_name,
        origin: train.origin_station,
        destination: train.destination_station,
      })),
    };
  }

  if (name === "search_train_arrivals") {
    const query = input.query;
    const targetTimeMinutes = input.targetTimeMinutes;
    if (
      typeof query !== "string" ||
      query.trim().length === 0 ||
      typeof targetTimeMinutes !== "number" ||
      !Number.isFinite(targetTimeMinutes)
    ) {
      throw new Error("到着列車の検索条件が不正です。");
    }
    const requestedLimit =
      typeof input.limit === "number" && Number.isInteger(input.limit)
        ? input.limit
        : 5;
    const limit = Math.max(1, Math.min(5, requestedLimit));
    const search = searchTrainArrivalsFromPrompt(
      originalPrompt,
      dependencies.trains,
      limit,
      arrivalSearchWindowMinutes,
      targetTimeMinutes,
    );
    for (const { train } of search.matches) {
      searchableServiceUids.add(train.service_uid);
    }
    return {
      windowMinutes: search.windowMinutes,
      targetTimeMinutes: search.targetTimeMinutes,
      totalMatchCount: search.totalMatchCount,
      matches: search.matches.map(({ train, stationName, arrivalTimeMinutes }) => ({
        serviceUid: train.service_uid,
        trainNumber: train.train_no,
        serviceType: train.service_type,
        trainName: train.train_name,
        origin: train.origin_station,
        destination: train.destination_station,
        stationName,
        arrivalTimeMinutes,
      })),
    };
  }

  if (name === "search_direct_routes") {
    const { originStation, destinationStation, departureTimeMinutes } = input;
    if (
      (originStation !== undefined && typeof originStation !== "string") ||
      typeof destinationStation !== "string" ||
      destinationStation.trim().length === 0 ||
      typeof departureTimeMinutes !== "number" ||
      !Number.isFinite(departureTimeMinutes) ||
      !dependencies.searchDirectRoutes
    ) {
      throw new Error("直通経路の検索条件が不正です。");
    }
    const response = await dependencies.searchDirectRoutes({
      ...(typeof originStation === "string" && originStation.trim()
        ? { originStation: originStation.trim() }
        : {}),
      destinationStation: destinationStation.trim(),
      departureTimeMinutes,
    });
    for (const result of response.results) {
      directRouteServiceUids.add(result.train.service_uid);
    }
    return {
      originStation: response.originStation,
      ...(response.distanceMeters === undefined
        ? {}
        : { distanceMeters: Math.round(response.distanceMeters) }),
      matches: response.results.map((result) => ({
        serviceUid: result.train.service_uid,
        trainNumber: result.train.train_no,
        serviceType: result.train.service_type,
        trainName: result.train.train_name,
        originStation: result.originStation,
        destinationStation: result.destinationStation,
        departureTimeMinutes: result.departureTimeMinutes,
        arrivalTimeMinutes: result.arrivalTimeMinutes,
      })),
    };
  }

  if (name === "focus_train") {
    const serviceUid = input.serviceUid;
    if (
      typeof serviceUid !== "string" ||
      (!searchableServiceUids.has(serviceUid) &&
        !directRouteServiceUids.has(serviceUid))
    ) {
      throw new Error("検索結果に含まれない列車は選択できません。");
    }
    const [action] = parseViewerAgentActions([
      { type: "focus_train", serviceUid },
    ]);
    if (
      !action ||
      action.type !== "focus_train" ||
      !dependencies.focusTrain(action.serviceUid)
    ) {
      throw new Error("列車の現在位置へ移動できませんでした。");
    }
    return { serviceUid, focused: true };
  }

  if (name === "query_daily_congestion_analysis") {
    const serviceDate = input.serviceDate;
    if (
      typeof serviceDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
    ) {
      throw new Error("混雑履歴の日付が不正です。");
    }
    return dependencies.queryDailyCongestionAnalysis(serviceDate);
  }

  if (name === "query_train_delay_analysis") {
    const serviceDate = input.serviceDate;
    if (
      typeof serviceDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
    ) {
      throw new Error("列車遅延の日付が不正です。");
    }
    return dependencies.queryTrainDelayAnalysis(serviceDate);
  }

  if (name === "search_representative_timetable") {
    const { timetableKind, query, mode, targetTimeMinutes } = input;
    if (
      (timetableKind !== "weekday" &&
        timetableKind !== "weekend_holiday") ||
      typeof query !== "string" ||
      query.trim().length === 0 ||
      (mode !== "active" && mode !== "arrivals" && mode !== "departures") ||
      (targetTimeMinutes !== undefined &&
        (typeof targetTimeMinutes !== "number" ||
          !Number.isFinite(targetTimeMinutes))) ||
      !dependencies.searchRepresentativeTimetable
    ) {
      throw new Error("代表ダイヤの検索条件が不正です。");
    }
    const requestedLimit =
      typeof input.limit === "number" && Number.isInteger(input.limit)
        ? input.limit
        : 5;
    return dependencies.searchRepresentativeTimetable({
      timetableKind,
      query,
      mode,
      ...(targetTimeMinutes === undefined ? {} : { targetTimeMinutes }),
      limit: Math.max(1, Math.min(5, requestedLimit)),
    });
  }

  if (name === "set_weather") {
    const [action] = parseViewerAgentActions([
      { type: "set_weather", weather: input.weather },
    ]);
    if (!action || action.type !== "set_weather") {
      throw new Error("天気を変更できません。");
    }
    dependencies.setWeather(action.weather);
    return { weather: action.weather };
  }

  if (name === "set_layer_visibility") {
    const [action] = parseViewerAgentActions([
      {
        type: "set_layer_visibility",
        layer: input.layer,
        visible: input.visible,
      },
    ]);
    if (!action || action.type !== "set_layer_visibility") {
      throw new Error("表示レイヤーを変更できません。");
    }
    dependencies.setLayerVisibility(action.layer, action.visible);
    return { layer: action.layer, visible: action.visible };
  }

  throw new Error("許可されていないツールです。");
}

export function currentDateInJapan(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function isToolUseBlock(
  block: BedrockAgentContentBlock,
): block is Extract<BedrockAgentContentBlock, { toolUse: unknown }> {
  return "toolUse" in block;
}

function isTextBlock(
  block: BedrockAgentContentBlock,
): block is Extract<BedrockAgentContentBlock, { text: string }> {
  return "text" in block;
}
