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
import {
  defaultJourneySearchPreferences,
  journeySearchPreferencesFromPrompt,
  type JourneyRankingPreference,
  type JourneySearchPreferences,
  type TransferPace,
} from "./journey-search-preferences";
import { operatingDayRouteTime } from "./playback";
import type { TrainPosition } from "./train-position";
import type {
  ViewerAgentJourneyPlan,
  ViewerAgentResponse,
} from "./viewer-agent-response";
import {
  directRouteDepartureTime,
  type DirectRouteSearchResponse,
} from "./direct-route-search";
import {
  parseViewerAgentActions,
  type ViewerAgentLayer,
} from "./viewer-agent-action";
import {
  arrivalSearchWindowMinutes,
  currentCalendarDateInJapan,
  directRouteRequestFromPrompt,
  formatStationLabel,
  routeTimeFromPrompt,
  routeCalendarDateFromPrompt,
  searchActiveTrainsFromPrompt,
  searchTrainArrivalsFromPrompt,
} from "./viewer-agent-local-tools";

export interface BedrockViewerAgentDependencies {
  trains: Train[];
  getTrains?: () => Train[];
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
    serviceDate?: string;
    departureDate?: string;
    transferPace?: TransferPace;
    rankingPreference?: JourneyRankingPreference;
    maxTransfers?: 0 | 1 | 2 | 3;
  }) => Promise<DirectRouteSearchResponse>;
  getCurrentDate?: () => Date;
  getJourneySearchPreferences?: () => JourneySearchPreferences;
  getPreviousJourneyPlan?: () => ViewerAgentJourneyPlan | undefined;
  maximumRouteTime: number;
}

export type BedrockAgentConverse = (
  messages: BedrockAgentMessage[],
) => Promise<BedrockAgentResponse>;

const maximumToolRounds = 6;

interface DirectRouteToolMatch {
  serviceUid: string;
  trainNumber: string;
  serviceType: string;
  trainName: string;
  serviceDestination?: string;
  originStation: string;
  destinationStation: string;
  departureTimeMinutes: number;
  arrivalTimeMinutes: number;
  lineName?: string;
  lineColor?: string;
  stops?: Array<{
    stationName: string;
    arrivalTimeMinutes?: number;
    departureTimeMinutes?: number;
  }>;
}

interface DirectRouteToolState {
  searched: boolean;
  focusedServiceUid?: string;
  response?: {
    serviceDate?: string;
    departureDate?: string;
    transferPace: TransferPace;
    rankingPreference: JourneyRankingPreference;
    maxTransfers: number;
    originStation: string;
    destinationStation: string;
    searchTimeMinutes: number;
    journeys: Array<{
      departureTimeMinutes: number;
      arrivalTimeMinutes: number;
      transferCount: number;
      legs: DirectRouteToolMatch[];
    }>;
  };
}

export async function runBedrockViewerAgent(
  prompt: string,
  dependencies: BedrockViewerAgentDependencies,
  converse: BedrockAgentConverse,
): Promise<ViewerAgentResponse> {
  const followUpResponse = journeyTrainFollowUpResponse(
    prompt,
    dependencies.getPreviousJourneyPlan?.(),
  );
  if (followUpResponse) {
    return followUpResponse;
  }
  const messages: BedrockAgentMessage[] = [
    {
      role: "user",
      content: [
        {
          text:
            `利用者の依頼: ${prompt}\n` +
            `現在の表示時刻（0時からの分数）: ${dependencies.getRouteTime()}\n` +
            `今日の実日付（日本時間）: ${currentCalendarDateInJapan(currentDate(dependencies))}\n` +
            `現在の業務日付（日本時間4時切替）: ${currentServiceDateInJapan(currentDate(dependencies))}`,
        },
      ],
    },
  ];
  const searchableServiceUids = new Set<string>();
  const directRouteServiceUids = new Set<string>();
  const toolState: DirectRouteToolState = { searched: false };

  for (let round = 0; round < maximumToolRounds; round += 1) {
    const response = await converse(messages);
    messages.push(response.message);
    const toolUses = response.message.content.filter(isToolUseBlock);

    if (toolUses.length === 0) {
      const directRouteResponse = directRouteResponseText(toolState);
      if (directRouteResponse !== undefined) {
        return directRouteResponse;
      }
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
          toolState,
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

    // 経路候補と表示文は検索ツールの構造化結果だけから確定できる。
    // モデルへ再送すると不要な画面操作を繰り返す場合があるためここで終了する。
    const directRouteResponse = directRouteResponseText(toolState);
    if (directRouteResponse !== undefined) {
      return directRouteResponse;
    }
  }

  throw new Error("AIの画面操作回数が上限を超えました。");
}

function journeyTrainFollowUpResponse(
  prompt: string,
  plan: ViewerAgentJourneyPlan | undefined,
): ViewerAgentResponse | undefined {
  if (!plan) {
    return undefined;
  }
  const normalizedPrompt = prompt.normalize("NFKC").replace(/\s+/gu, "");
  for (const [journeyIndex, journey] of plan.journeys.entries()) {
    for (const leg of journey.legs) {
      const trainName = leg.trainName.trim();
      const baseTrainName = trainName.replace(/\d+号$/u, "");
      const keys = [leg.trainNumber, trainName, baseTrainName]
        .map((value) => value.normalize("NFKC").replace(/\s+/gu, ""))
        .filter((value) => value.length >= 2);
      if (!keys.some((value) => normalizedPrompt.includes(value))) {
        continue;
      }
      const serviceLabel = [leg.serviceType, trainName || leg.trainNumber]
        .filter(Boolean)
        .join(" ");
      return {
        text: `直前の候補${journeyIndex + 1}では${formatStationLabel(leg.originStation)}を${formatClockTime(leg.departureTimeMinutes)}に発車する${serviceLabel}を利用し ${formatStationLabel(leg.destinationStation)}へ向かいます。`,
        journeyPlan: plan,
      };
    }
  }
  return undefined;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  originalPrompt: string,
  dependencies: BedrockViewerAgentDependencies,
  searchableServiceUids: Set<string>,
  directRouteServiceUids: Set<string>,
  toolState: DirectRouteToolState,
): Promise<unknown> {
  if (name === "set_display_time") {
    const requestedTime = input.routeTimeMinutes;
    if (typeof requestedTime !== "number" || !Number.isFinite(requestedTime)) {
      throw new Error("表示時刻が不正です。");
    }
    if (toolState.searched) {
      return {
        routeTimeMinutes: dependencies.getRouteTime(),
        changed: false,
        reason: "経路検索では表示時刻を変更しません。",
      };
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
      currentTrains(dependencies),
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
      currentTrains(dependencies),
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
    const { departureTimeMinutes } = input;
    const promptRequest = directRouteRequestFromPrompt(
      originalPrompt,
      dependencies.trains,
    );
    const originStation = promptRequest?.originStation ?? input.originStation;
    const destinationStation =
      promptRequest?.destinationStation ?? input.destinationStation;
    if (
      (originStation !== undefined && typeof originStation !== "string") ||
      typeof destinationStation !== "string" ||
      destinationStation.trim().length === 0 ||
      typeof departureTimeMinutes !== "number" ||
      !Number.isFinite(departureTimeMinutes) ||
      !dependencies.searchDirectRoutes
    ) {
      throw new Error("経路の検索条件が不正です。");
    }
    const promptDepartureTime = routeTimeFromPrompt(originalPrompt);
    const resolvedDepartureTime = directRouteDepartureTime(
      promptDepartureTime,
      dependencies.getRouteTime(),
      dependencies.maximumRouteTime,
    );
    const routeDate =
      routeCalendarDateFromPrompt(
        originalPrompt,
        resolvedDepartureTime,
        currentDate(dependencies),
      ) ??
      (typeof input.departureDate === "string"
        ? routeCalendarDateFromPrompt(
            input.departureDate,
            resolvedDepartureTime,
            currentDate(dependencies),
          )
        : undefined);
    const preferences = journeySearchPreferencesFromPrompt(
      originalPrompt,
      dependencies.getJourneySearchPreferences?.() ??
        defaultJourneySearchPreferences,
    );
    const response = await dependencies.searchDirectRoutes({
      ...(typeof originStation === "string" && originStation.trim()
        ? { originStation: originStation.trim() }
        : {}),
      destinationStation: destinationStation.trim(),
      departureTimeMinutes: resolvedDepartureTime,
      ...(routeDate ?? {}),
      ...preferences,
    });
    toolState.searched = true;
    directRouteServiceUids.clear();
    const journeys = response.journeys ?? response.results.map((route) => ({
      departureTimeMinutes: route.departureTimeMinutes,
      arrivalTimeMinutes: route.arrivalTimeMinutes,
      transferCount: 0,
      legs: [{
        serviceUid: route.train.service_uid,
        trainNumber: route.train.train_no,
        serviceType: route.train.service_type,
        trainName: route.train.train_name,
        serviceDestination: route.train.destination_station,
        originStation: route.originStation,
        destinationStation: route.destinationStation,
        departureTimeMinutes: route.departureTimeMinutes,
        arrivalTimeMinutes: route.arrivalTimeMinutes,
      }],
    }));
    for (const journey of journeys) {
      for (const leg of journey.legs) {
        directRouteServiceUids.add(leg.serviceUid);
      }
    }
    const result = {
      serviceDate: response.serviceDate ?? routeDate?.serviceDate,
      departureDate: response.departureDate ?? routeDate?.departureDate,
      transferPace: response.transferPace ?? preferences.transferPace,
      rankingPreference:
        response.rankingPreference ?? preferences.rankingPreference,
      maxTransfers: response.maxTransfers ?? preferences.maxTransfers,
      originStation: response.originStation,
      destinationStation: destinationStation.trim(),
      searchTimeMinutes: resolvedDepartureTime,
      ...(response.distanceMeters === undefined
        ? {}
        : { distanceMeters: Math.round(response.distanceMeters) }),
      journeys,
    };
    toolState.response = result;
    const firstServiceUid = journeys[0]?.legs[0]?.serviceUid;
    if (firstServiceUid && dependencies.focusTrain(firstServiceUid)) {
      toolState.focusedServiceUid = firstServiceUid;
    }
    return result;
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
    if (directRouteServiceUids.has(serviceUid)) {
      toolState.focusedServiceUid = serviceUid;
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

export function currentServiceDateInJapan(now = new Date()): string {
  const operatingDayNow = new Date(now.getTime() - 4 * 60 * 60 * 1_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(operatingDayNow);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function directRouteResponseText(
  state: DirectRouteToolState,
): ViewerAgentResponse | undefined {
  const response = state.response;
  if (!response) {
    return undefined;
  }
  if (response.journeys.length === 0) {
    return `${formatClockTime(response.searchTimeMinutes)}以降に${formatStationLabel(response.originStation)}から${formatStationLabel(response.destinationStation)}へ行く経路は見つかりませんでした。`;
  }
  const first = response.journeys[0]?.legs[0];
  const focusMessage =
    first && state.focusedServiceUid === first.serviceUid
      ? "先頭の列車にフォーカスしました。"
      : "先頭の列車はまだ表示時刻に運行していないため、経路のみ案内します。";
  const dateLabel = response.departureDate
    ? `${formatCalendarDate(response.departureDate)}の`
    : "";
  return {
    text: `${dateLabel}${formatStationLabel(response.originStation)}から${formatStationLabel(response.destinationStation)}への経路候補です。${focusMessage}`,
    journeyPlan: {
      ...(response.departureDate ? { departureDate: response.departureDate } : {}),
      ...(response.serviceDate ? { serviceDate: response.serviceDate } : {}),
      transferPace: response.transferPace,
      rankingPreference: response.rankingPreference,
      maxTransfers: response.maxTransfers,
      originStation: response.originStation,
      destinationStation: response.destinationStation,
      journeys: response.journeys,
    },
  };
}

function formatCalendarDate(value: string): string {
  const [, , month, day] = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value) ?? [];
  return month && day ? `${Number(month)}月${Number(day)}日` : value;
}

function formatClockTime(routeTimeMinutes: number): string {
  const roundedMinutes = Math.round(routeTimeMinutes);
  const clockMinutes = ((roundedMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${Math.floor(clockMinutes / 60)}時${String(clockMinutes % 60).padStart(2, "0")}分`;
}

function currentTrains(dependencies: BedrockViewerAgentDependencies): Train[] {
  return dependencies.getTrains?.() ?? dependencies.trains;
}

function currentDate(dependencies: BedrockViewerAgentDependencies): Date {
  return dependencies.getCurrentDate?.() ?? new Date();
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
