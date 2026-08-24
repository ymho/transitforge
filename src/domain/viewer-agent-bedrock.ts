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
  ViewerAgentTravelPlan,
  ViewerAgentResponse,
} from "./viewer-agent-response";
import { journeyChatFollowUpIntent } from "./journey-chat-follow-up";
import {
  journeyNavigationGuidanceFromPrompt,
  mergeJourneyNavigationGuidance,
  type JourneyNavigationGuidance,
} from "./journey-navigation-intent";
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
  isUsableOriginStation,
  routeTimeFromPrompt,
  routeCalendarDateFromPrompt,
  searchActiveTrainsFromPrompt,
  searchTrainArrivalsFromPrompt,
} from "./viewer-agent-local-tools";
import { travelDestinationAccess } from "./travel-destination";
import {
  normalizedConversationGuidance,
  type ConversationExpectedInput,
  type ConversationGuidance,
} from "./conversation-guidance";
import type { TripContext, UserProfile } from "./travel-profile";
import {
  tripPlanPatchesFromTravelPlan,
  type MovementMode,
  type TripPlan,
  type TripPlanPatch,
  type TripPlanUpdateProposal,
} from "./trip-plan";
import type { ConversationScope } from "./conversation-session";

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
    excludedServiceTypes?: string[];
    excludedTrainNames?: string[];
    excludedTrainNumbers?: string[];
    excludedServiceUids?: string[];
    requiredServiceTypes?: string[];
    requiredTrainNames?: string[];
    requiredTrainNumbers?: string[];
    allowedServiceTypes?: string[];
  }) => Promise<DirectRouteSearchResponse>;
  searchAccommodations?: (request: {
    destination: string;
    checkInDate: string;
    checkOutDate: string;
    adults?: number;
    limit?: number;
  }) => Promise<unknown>;
  getCurrentDate?: () => Date;
  getJourneySearchPreferences?: () => JourneySearchPreferences;
  getPreviousJourneyPlan?: () => ViewerAgentJourneyPlan | undefined;
  getPendingJourneyGuidance?: () => JourneyNavigationGuidance | undefined;
  conciergeInstruction?: string;
  rememberTravelPreference?: (statement: string, confidence: "low" | "high") => void;
  updateConversationSession?: (update: {
    scope?: ConversationScope;
    summary?: string;
    resolvedTopics?: string[];
    pendingTopics?: string[];
  }) => void;
  getTripPlan?: () => TripPlan | undefined;
  getUserProfile?: () => UserProfile | undefined;
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
    excludedServiceTypes?: string[];
    excludedTrainNames?: string[];
    excludedTrainNumbers?: string[];
    excludedServiceUids?: string[];
    requiredServiceTypes?: string[];
    requiredTrainNames?: string[];
    requiredTrainNumbers?: string[];
    allowedServiceTypes?: string[];
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

interface TravelToolState {
  response?: ViewerAgentTravelPlan;
}

interface ConversationToolState {
  response?: ConversationGuidance;
}
interface TripPlanUpdateToolState {
  proposal?: TripPlanUpdateProposal;
}

export async function runBedrockViewerAgent(
  prompt: string,
  dependencies: BedrockViewerAgentDependencies,
  converse: BedrockAgentConverse,
): Promise<ViewerAgentResponse> {
  const constraintResponse = await journeyConstraintFollowUpResponse(
    prompt,
    dependencies,
  );
  if (constraintResponse !== undefined) {
    return constraintResponse;
  }
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
            (dependencies.conciergeInstruction === undefined
              ? ""
              : `コンシェルジュの会話方針:\n${dependencies.conciergeInstruction}\n\n`) +
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
  const travelState: TravelToolState = {};
  const conversationState: ConversationToolState = {};
  const tripPlanUpdateState: TripPlanUpdateToolState = {};

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
          travelState,
          conversationState,
          tripPlanUpdateState,
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
    const travelResponse = travelResponseText(
      travelState,
      dependencies.getTripPlan?.(),
      dependencies.getUserProfile?.(),
    );
    if (travelResponse !== undefined) {
      return travelResponse;
    }
    const conversationResponse = conversationResponseText(conversationState);
    if (conversationResponse !== undefined) {
      return conversationResponse;
    }
    if (tripPlanUpdateState.proposal) {
      return {
        text: tripPlanUpdateState.proposal.summary,
        tripPlanUpdate: tripPlanUpdateState.proposal,
      };
    }
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
  travelState: TravelToolState,
  conversationState: ConversationToolState,
  tripPlanUpdateState: TripPlanUpdateToolState,
): Promise<unknown> {
  if (name === "propose_trip_update") {
    const current = dependencies.getTripPlan?.();
    const summary = typeof input.summary === "string" ? input.summary.trim() : "";
    if (!current || !summary) throw new Error("変更する旅程がありません。");
    const patches = tripPlanPatchesFromToolInput(input.patches, current);
    if (patches.length === 0) throw new Error("旅程の変更内容がありません。");
    tripPlanUpdateState.proposal = { summary, patches };
    return { proposed: true, summary };
  }
  if (name === "remember_travel_preference") {
    const statement = typeof input.statement === "string" ? input.statement.trim() : "";
    const confidence = input.confidence === "high" ? "high" : "low";
    if (!statement || statement.length > 160) throw new Error("記憶する内容が不正です。");
    dependencies.rememberTravelPreference?.(statement, confidence);
    return { remembered: true, statement, confidence };
  }
  if (name === "update_conversation_session") {
    const list = (value: unknown) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
          .map((item) => item.slice(0, 80))
          .slice(0, 8)
      : undefined;
    const resolvedTopics = list(input.resolvedTopics);
    const pendingTopics = list(input.pendingTopics);
    dependencies.updateConversationSession?.({
      ...(isConversationScope(input.scope) ? { scope: input.scope } : {}),
      ...(typeof input.summary === "string"
        ? { summary: input.summary.slice(0, 400) }
        : {}),
      ...(resolvedTopics ? { resolvedTopics } : {}),
      ...(pendingTopics ? { pendingTopics } : {}),
    });
    return { updated: true };
  }
  if (name === "ask_follow_up") {
    const guidance = conversationGuidanceFromToolInput(input);
    conversationState.response = guidance;
    return { accepted: true, ...guidance };
  }
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
    if (isStayTravelRequest(originalPrompt)) {
      throw new Error(
        "宿泊を伴う旅行相談では、まずsearch_accommodationsで行き先と宿泊日を検索してください。観光地は駅名として経路検索しません。",
      );
    }
    const originStation = promptRequest?.originStation ??
      explicitOriginStationFromPrompt(originalPrompt, input.originStation);
    const destinationStation =
      promptRequest?.destinationStation ?? input.destinationStation;
    if (
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
    const guidance = mergeJourneyNavigationGuidance(
      dependencies.getPendingJourneyGuidance?.(),
      journeyNavigationGuidanceFromPrompt(originalPrompt, dependencies.trains),
    );
    const defaultPreferences = dependencies.getJourneySearchPreferences?.() ??
      defaultJourneySearchPreferences;
    const preferences = journeySearchPreferencesFromPrompt(originalPrompt, {
      transferPace: guidance.transferPace ?? defaultPreferences.transferPace,
      rankingPreference:
        guidance.rankingPreference ?? defaultPreferences.rankingPreference,
      maxTransfers: guidance.maxTransfers ?? defaultPreferences.maxTransfers,
    });
    const response = await dependencies.searchDirectRoutes({
      ...(typeof originStation === "string" && originStation.trim()
        ? { originStation: originStation.trim() }
        : {}),
      destinationStation: destinationStation.trim(),
      departureTimeMinutes: resolvedDepartureTime,
      ...(routeDate ?? {}),
      ...preferences,
      ...(guidance.requiredServiceTypes.length
        ? { requiredServiceTypes: guidance.requiredServiceTypes }
        : {}),
      ...(guidance.requiredTrainNames.length
        ? { requiredTrainNames: guidance.requiredTrainNames }
        : {}),
      ...(guidance.requiredTrainNumbers.length
        ? { requiredTrainNumbers: guidance.requiredTrainNumbers }
        : {}),
      ...(guidance.allowedServiceTypes.length
        ? { allowedServiceTypes: guidance.allowedServiceTypes }
        : {}),
      ...(guidance.excludedServiceTypes.length
        ? { excludedServiceTypes: guidance.excludedServiceTypes }
        : {}),
      ...(guidance.excludedTrainNames.length
        ? { excludedTrainNames: guidance.excludedTrainNames }
        : {}),
      ...(guidance.excludedTrainNumbers.length
        ? { excludedTrainNumbers: guidance.excludedTrainNumbers }
        : {}),
    });
    toolState.searched = true;
    directRouteServiceUids.clear();
    const journeys = journeysFromSearchResponse(response);
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
      ...((response.excludedServiceTypes ?? guidance.excludedServiceTypes).length
        ? { excludedServiceTypes:
          response.excludedServiceTypes ?? guidance.excludedServiceTypes }
        : {}),
      ...((response.excludedTrainNames ?? guidance.excludedTrainNames).length
        ? { excludedTrainNames:
          response.excludedTrainNames ?? guidance.excludedTrainNames }
        : {}),
      ...((response.excludedTrainNumbers ?? guidance.excludedTrainNumbers).length
        ? { excludedTrainNumbers:
          response.excludedTrainNumbers ?? guidance.excludedTrainNumbers }
        : {}),
      ...(response.excludedServiceUids?.length
        ? { excludedServiceUids: response.excludedServiceUids }
        : {}),
      requiredServiceTypes:
        response.requiredServiceTypes ?? guidance.requiredServiceTypes,
      requiredTrainNames:
        response.requiredTrainNames ?? guidance.requiredTrainNames,
      requiredTrainNumbers:
        response.requiredTrainNumbers ?? guidance.requiredTrainNumbers,
      allowedServiceTypes:
        response.allowedServiceTypes ?? guidance.allowedServiceTypes,
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

  if (name === "search_accommodations") {
    const { destination, checkInDate, checkOutDate } = input;
    if (
      typeof destination !== "string" || destination.trim().length === 0 ||
      typeof checkInDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(checkInDate) ||
      typeof checkOutDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate) ||
      !dependencies.searchAccommodations
    ) {
      throw new Error("宿泊候補の検索条件が不正です。");
    }
    const requestedLimit = typeof input.limit === "number" && Number.isInteger(input.limit)
      ? input.limit : 3;
    const adults = typeof input.adults === "number" && Number.isInteger(input.adults)
      ? input.adults : 1;
    const children = boundedInteger(input.children, 0, 10) ?? 0;
    const considerations = Array.isArray(input.considerations)
      ? input.considerations.flatMap((item) =>
        typeof item === "string" && item.trim()
          ? [item.trim().slice(0, 80)]
          : []).slice(0, 8)
      : [];
    const travelDestination = travelDestinationAccess(destination);
    const accommodations = await dependencies.searchAccommodations({
      destination: travelDestination?.accommodationDestination ?? destination.trim(), checkInDate, checkOutDate,
      adults: Math.max(1, Math.min(10, adults)), limit: Math.max(1, Math.min(5, requestedLimit)),
    });
    if (isStayTravelRequest(originalPrompt) && dependencies.searchDirectRoutes) {
      const destinationStation = travelDestination?.accessStation ??
        stationForTravelDestination(destination, dependencies.trains);
      if (destinationStation) {
        const preferences = dependencies.getJourneySearchPreferences?.() ??
          defaultJourneySearchPreferences;
        const profileOriginStation = dependencies.getUserProfile?.()?.home.station;
        const outboundResult = await dependencies.searchDirectRoutes({
          ...(profileOriginStation ? { originStation: profileOriginStation } : {}),
          destinationStation,
          departureTimeMinutes: 8 * 60,
          departureDate: checkInDate,
          serviceDate: checkInDate,
          ...preferences,
        });
        const outbound = journeyPlanFromSearchResponse(outboundResult, {
          destinationStation,
          departureDate: checkInDate,
          searchTimeMinutes: 8 * 60,
          preferences,
        });
        const returningResult = await dependencies.searchDirectRoutes({
          originStation: destinationStation,
          destinationStation: outbound.originStation,
          departureTimeMinutes: 10 * 60,
          departureDate: checkOutDate,
          serviceDate: checkOutDate,
          ...preferences,
        });
        travelState.response = {
          destination: destination.trim(),
          adults: Math.max(1, Math.min(10, adults)),
          children,
          considerations,
          checkInDate,
          checkOutDate,
          outbound,
          returning: journeyPlanFromSearchResponse(returningResult, {
            originStation: destinationStation,
            destinationStation: outbound.originStation,
            departureDate: checkOutDate,
            searchTimeMinutes: 10 * 60,
            preferences,
          }),
          accommodations: accommodationValues(accommodations),
        };
      }
    }
    return accommodations;
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

function explicitOriginStationFromPrompt(
  prompt: string,
  value: unknown,
): string | undefined {
  if (!isUsableOriginStation(value)) {
    return undefined;
  }
  const candidate = value.trim();
  const normalizedPrompt = normalizeStationPrompt(prompt);
  const normalizedCandidate = normalizeStationPrompt(candidate);
  return normalizedCandidate && normalizedPrompt.includes(normalizedCandidate)
    ? candidate
    : undefined;
}

function normalizeStationPrompt(value: string): string {
  return value.normalize("NFKC").replace(/駅$/u, "").replace(/\s+/gu, "");
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

function travelResponseText(
  state: TravelToolState,
  currentPlan?: TripPlan,
  profile?: UserProfile,
): ViewerAgentResponse | undefined {
  const plan = state.response;
  if (!plan) return undefined;
  const advisory = travelBurdenAdvisory(plan, profile);
  if (currentPlan) {
    return {
      text: `${formatCalendarDate(plan.checkInDate)}から${formatCalendarDate(plan.checkOutDate)}へ日程と経路を組み直しました。${advisory}変更内容を確認してください。`,
      tripPlanUpdate: {
        summary: `${formatCalendarDate(plan.checkInDate)}から${formatCalendarDate(plan.checkOutDate)}の日程へ変更`,
        patches: tripPlanPatchesFromTravelPlan(plan),
      },
    };
  }
  return {
    text: `${formatCalendarDate(plan.checkInDate)}から${formatCalendarDate(plan.checkOutDate)}までの${plan.destination}旅行です。${advisory}行きと帰りの経路、宿泊候補をまとめました。`,
    travelPlan: plan,
  };
}

function travelBurdenAdvisory(
  plan: ViewerAgentTravelPlan,
  profile?: UserProfile,
): string {
  const journey = plan.outbound.journeys[0];
  if (!journey || !profile) return "";
  const concerns: string[] = [];
  const maximum = profile.transport.maxTypicalTravelMinutes;
  const duration = journey.arrivalTimeMinutes - journey.departureTimeMinutes;
  if (maximum !== null && duration > maximum + 30) {
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    const durationLabel = `${hours > 0 ? `${hours}時間` : ""}${minutes > 0 ? `${minutes}分` : ""}`;
    concerns.push(`行きの移動は${durationLabel}で、普段許容している移動時間より長め`);
  }
  if (profile.travelStyle.transferTolerance <= 0.35 && journey.transferCount >= 2) {
    concerns.push(`乗換が${journey.transferCount}回あり、普段の好みより多め`);
  }
  return concerns.length === 0
    ? ""
    : `${concerns.join("です。また、")}です。候補は作りましたが、負担を軽くしたい場合は移動条件を調整できます。`;
}

function tripPlanPatchesFromToolInput(value: unknown, current: TripPlan): TripPlanPatch[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((raw): TripPlanPatch[] => {
    if (!raw || typeof raw !== "object") return [];
    const patch = raw as Record<string, unknown>;
    if (patch.type === "metadata") {
      const title = typeof patch.title === "string" ? patch.title.trim().slice(0, 80) : undefined;
      const destination = typeof patch.destination === "string" ? patch.destination.trim().slice(0, 80) : undefined;
      const adults = boundedInteger(patch.adults, 0, 20);
      const children = boundedInteger(patch.children, 0, 20);
      const considerations = Array.isArray(patch.considerations)
        ? patch.considerations.flatMap((item) =>
          typeof item === "string" && item.trim()
            ? [item.trim().slice(0, 80)]
            : []).slice(0, 8)
        : undefined;
      const hasConditions = adults !== undefined || children !== undefined ||
        considerations !== undefined;
      const conditions = hasConditions ? {
        adults: adults ?? current.conditions?.adults ?? 1,
        children: children ?? current.conditions?.children ?? 0,
        considerations: considerations ?? current.conditions?.considerations ?? [],
      } : undefined;
      if (conditions && conditions.adults + conditions.children < 1) return [];
      return title || destination || conditions ? [{
        type: "metadata",
        ...(title ? { title } : {}),
        ...(destination ? { destination } : {}),
        ...(conditions ? { conditions } : {}),
      }] : [];
    }
    const itemId = typeof patch.itemId === "string" && current.items.some((item) => item.id === patch.itemId) ? patch.itemId : undefined;
    if (patch.type === "remove" && itemId) return [{ type: "remove", itemId }];
    if (patch.type === "move" && itemId) {
      const afterId = typeof patch.afterId === "string" && current.items.some((item) => item.id === patch.afterId) ? patch.afterId : undefined;
      return [{ type: "move", itemId, ...(afterId ? { afterId } : {}) }];
    }
    if (patch.type === "addSightseeing" && typeof patch.name === "string" && patch.name.trim()) {
      const afterId = typeof patch.afterId === "string" && current.items.some((item) => item.id === patch.afterId) ? patch.afterId : undefined;
      return [{ type: "add", item: { id: `sightseeing-${crypto.randomUUID()}`, type: "sightseeing", place: { name: patch.name.trim().slice(0, 100), provider: "manual" }, ...(typeof patch.date === "string" ? { date: patch.date.slice(0, 10) } : {}) }, ...(afterId ? { afterId } : {}) }];
    }
    if (patch.type === "addMovement" && isManualMovementMode(patch.mode) &&
      typeof patch.origin === "string" && patch.origin.trim() &&
      typeof patch.destination === "string" && patch.destination.trim()) {
      const afterId = typeof patch.afterId === "string" &&
        current.items.some((item) => item.id === patch.afterId)
        ? patch.afterId
        : undefined;
      return [{
        type: "add",
        item: {
          id: `movement-${crypto.randomUUID()}`,
          type: "movement",
          mode: patch.mode,
          origin: patch.origin.trim().slice(0, 100),
          destination: patch.destination.trim().slice(0, 100),
          ...(typeof patch.date === "string" ? { date: patch.date.slice(0, 10) } : {}),
          ...(typeof patch.note === "string" && patch.note.trim()
            ? { note: patch.note.trim().slice(0, 500) }
            : {}),
        },
        ...(afterId ? { afterId } : {}),
      }];
    }
    return [];
  });
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= minimum && value <= maximum ? value : undefined;
}

function isManualMovementMode(
  value: unknown,
): value is Exclude<MovementMode, "rail"> {
  return value === "rental-car" || value === "car" || value === "bus" ||
    value === "walk" || value === "other";
}

function isConversationScope(value: unknown): value is ConversationScope {
  return value === "general" || value === "trip" || value === "place" ||
    value === "route";
}

function conversationResponseText(
  state: ConversationToolState,
): ViewerAgentResponse | undefined {
  if (!state.response) return undefined;
  return { text: state.response.question, conversation: state.response };
}

function conversationGuidanceFromToolInput(
  input: Record<string, unknown>,
): ConversationGuidance {
  const question = typeof input.question === "string" ? input.question : "";
  if (!question.trim()) {
    throw new Error("次の質問が必要です。");
  }
  const expectedInput = isConversationExpectedInput(input.expectedInput)
    ? input.expectedInput
    : "free-text";
  const quickReplies = Array.isArray(input.quickReplies)
    ? input.quickReplies.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const reply = value as Record<string, unknown>;
      if (typeof reply.label !== "string" || typeof reply.value !== "string") return [];
      return [{ label: reply.label, value: reply.value }];
    })
    : [];
  return normalizedConversationGuidance({
    question,
    expectedInput,
    quickReplies,
    tripContext: tripContextFromToolInput(input.tripContext),
  });
}

function isConversationExpectedInput(value: unknown): value is ConversationExpectedInput {
  return value === "departure-date" || value === "stay-length" ||
    value === "traveler-count" || value === "free-text";
}

function tripContextFromToolInput(value: unknown): TripContext {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const stringValue = (key: string) =>
    typeof input[key] === "string" && input[key].trim() ? input[key].trim() : undefined;
  return {
    ...(stringValue("destinationWish") ? { destinationWish: stringValue("destinationWish") } : {}),
    ...(stringValue("startDate") ? { startDate: stringValue("startDate") } : {}),
    ...(stringValue("endDate") ? { endDate: stringValue("endDate") } : {}),
    ...(typeof input.pace === "number" && input.pace >= 0 && input.pace <= 1
      ? { pace: input.pace }
      : {}),
    ...(typeof input.maximumTravelMinutes === "number" || input.maximumTravelMinutes === null
      ? { maximumTravelMinutes: input.maximumTravelMinutes as number | null }
      : {}),
    ...(typeof input.carAvailable === "boolean" ? { carAvailable: input.carAvailable } : {}),
  };
}

function isStayTravelRequest(prompt: string): boolean {
  const normalized = prompt.normalize("NFKC").replace(/\s+/gu, "");
  return /(?:旅行|観光|\d+泊|泊まり|宿泊)/u.test(normalized);
}

function stationForTravelDestination(
  destination: string,
  trains: Train[],
): string | undefined {
  const normalizedDestination = normalizeStationPrompt(destination);
  const stations = new Set(trains.flatMap((train) => [
    train.origin_station,
    train.destination_station,
    ...train.stops.flatMap((stop) => stop.station_name ? [stop.station_name] : []),
  ]).map((station) => station.replace(/駅$/u, "")));
  return [...stations].find((station) =>
    normalizeStationPrompt(station) === normalizedDestination,
  ) ?? [...stations].find((station) =>
    normalizeStationPrompt(station).startsWith(normalizedDestination),
  );
}


function journeyPlanFromSearchResponse(
  response: DirectRouteSearchResponse,
  fallback: {
    originStation?: string;
    destinationStation: string;
    departureDate: string;
    searchTimeMinutes: number;
    preferences: JourneySearchPreferences;
  },
): ViewerAgentJourneyPlan {
  return {
    departureDate: response.departureDate ?? fallback.departureDate,
    ...(response.serviceDate ? { serviceDate: response.serviceDate } : {}),
    originStation: response.originStation ?? fallback.originStation ?? "現在地近くの駅",
    destinationStation: fallback.destinationStation,
    transferPace: response.transferPace ?? fallback.preferences.transferPace,
    rankingPreference: response.rankingPreference ?? fallback.preferences.rankingPreference,
    maxTransfers: response.maxTransfers ?? fallback.preferences.maxTransfers,
    searchTimeMinutes: fallback.searchTimeMinutes,
    journeys: journeysFromSearchResponse(response),
  };
}

function accommodationValues(value: unknown): ViewerAgentTravelPlan["accommodations"] {
  if (!value || typeof value !== "object" || !("accommodations" in value) ||
    !Array.isArray(value.accommodations)) return [];
  return value.accommodations.flatMap((accommodation) => {
    if (!accommodation || typeof accommodation !== "object" ||
      typeof accommodation.name !== "string" ||
      typeof accommodation.checkInDate !== "string" ||
      typeof accommodation.checkOutDate !== "string") return [];
    return [{
      name: accommodation.name,
      checkInDate: accommodation.checkInDate,
      checkOutDate: accommodation.checkOutDate,
      ...(typeof accommodation.bookingUrl === "string"
        ? { bookingUrl: accommodation.bookingUrl }
        : {}),
      ...(typeof accommodation.areaName === "string"
        ? { areaName: accommodation.areaName }
        : {}),
      ...(typeof accommodation.imageUrl === "string"
        ? { imageUrl: accommodation.imageUrl }
        : {}),
    }];
  });
}

function directRouteResponseText(
  state: DirectRouteToolState,
): ViewerAgentResponse | undefined {
  const response = state.response;
  if (!response) {
    return undefined;
  }
  const excludedLabels = uniqueStrings([
    ...(response.excludedServiceTypes ?? []),
    ...(response.excludedTrainNames ?? []),
    ...(response.excludedTrainNumbers ?? []),
  ]);
  const exclusionLabel = excludedLabels.length
    ? `${excludedLabels.join("・")}を使わない条件で`
    : "";
  const requiredLabels = uniqueStrings([
    ...(response.requiredServiceTypes ?? []),
    ...(response.requiredTrainNames ?? []),
    ...(response.requiredTrainNumbers ?? []),
  ]);
  const requirementLabel = requiredLabels.length
    ? `${requiredLabels.join("・")}を利用する条件で`
    : response.allowedServiceTypes?.length
    ? `${response.allowedServiceTypes.join("・")}だけを利用する条件で`
    : "";
  if (response.journeys.length === 0) {
    return `${exclusionLabel}${requirementLabel}${formatClockTime(response.searchTimeMinutes)}以降に${formatStationLabel(response.originStation)}から${formatStationLabel(response.destinationStation)}へ行く経路は見つかりませんでした。`;
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
    text: `${exclusionLabel}${requirementLabel}${dateLabel}${formatStationLabel(response.originStation)}から${formatStationLabel(response.destinationStation)}への経路候補です。${focusMessage}`,
    journeyPlan: {
      ...(response.departureDate ? { departureDate: response.departureDate } : {}),
      ...(response.serviceDate ? { serviceDate: response.serviceDate } : {}),
      transferPace: response.transferPace,
      rankingPreference: response.rankingPreference,
      maxTransfers: response.maxTransfers,
      searchTimeMinutes: response.searchTimeMinutes,
      ...(response.excludedServiceTypes?.length
        ? { excludedServiceTypes: response.excludedServiceTypes }
        : {}),
      ...(response.excludedTrainNames?.length
        ? { excludedTrainNames: response.excludedTrainNames }
        : {}),
      ...(response.excludedTrainNumbers?.length
        ? { excludedTrainNumbers: response.excludedTrainNumbers }
        : {}),
      ...(response.excludedServiceUids?.length
        ? { excludedServiceUids: response.excludedServiceUids }
        : {}),
      ...(response.requiredServiceTypes?.length
        ? { requiredServiceTypes: response.requiredServiceTypes }
        : {}),
      ...(response.requiredTrainNames?.length
        ? { requiredTrainNames: response.requiredTrainNames }
        : {}),
      ...(response.requiredTrainNumbers?.length
        ? { requiredTrainNumbers: response.requiredTrainNumbers }
        : {}),
      ...(response.allowedServiceTypes?.length
        ? { allowedServiceTypes: response.allowedServiceTypes }
        : {}),
      originStation: response.originStation,
      destinationStation: response.destinationStation,
      journeys: response.journeys,
    },
  };
}

async function journeyConstraintFollowUpResponse(
  prompt: string,
  dependencies: BedrockViewerAgentDependencies,
): Promise<ViewerAgentResponse | undefined> {
  const plan = dependencies.getPreviousJourneyPlan?.();
  const exclusionIntent = journeyChatFollowUpIntent(prompt, plan);
  const parsedGuidance = journeyNavigationGuidanceFromPrompt(
    prompt,
    dependencies.trains,
  );
  const requestedGuidance = exclusionIntent?.type === "exclude-trains" &&
      parsedGuidance
    ? {
      ...parsedGuidance,
      excludedServiceTypes: [],
      excludedTrainNames: [],
      excludedTrainNumbers: [],
    }
    : parsedGuidance;
  if (
    !plan ||
    !dependencies.searchDirectRoutes ||
    (exclusionIntent?.type !== "exclude-trains" && !requestedGuidance)
  ) {
    return undefined;
  }
  const guidance = mergeJourneyNavigationGuidance({
    excludedServiceTypes: plan.excludedServiceTypes ?? [],
    excludedTrainNames: plan.excludedTrainNames ?? [],
    excludedTrainNumbers: plan.excludedTrainNumbers ?? [],
    requiredServiceTypes: plan.requiredServiceTypes ?? [],
    requiredTrainNames: plan.requiredTrainNames ?? [],
    requiredTrainNumbers: plan.requiredTrainNumbers ?? [],
    allowedServiceTypes: plan.allowedServiceTypes ?? [],
    transferPace: plan.transferPace,
    rankingPreference: plan.rankingPreference,
    maxTransfers: supportedMaximumTransfers(plan.maxTransfers),
  }, requestedGuidance);
  const excludedServiceTypes = uniqueStrings([
    ...guidance.excludedServiceTypes,
    ...(exclusionIntent?.type === "exclude-trains"
      ? exclusionIntent.exclusions.serviceTypes
      : []),
  ]).filter((value) =>
    !guidance.requiredServiceTypes.includes(value) &&
    !guidance.allowedServiceTypes.includes(value)
  );
  const excludedTrainNames = uniqueStrings([
    ...guidance.excludedTrainNames,
    ...(exclusionIntent?.type === "exclude-trains"
      ? exclusionIntent.exclusions.trainNames
      : []),
  ]).filter((value) => !guidance.requiredTrainNames.includes(value));
  const excludedTrainNumbers = uniqueStrings([
    ...guidance.excludedTrainNumbers,
    ...(exclusionIntent?.type === "exclude-trains"
      ? exclusionIntent.exclusions.trainNumbers
      : []),
  ]).filter((value) => !guidance.requiredTrainNumbers.includes(value));
  const excludedServiceUids = uniqueStrings([
    ...(plan.excludedServiceUids ?? []),
    ...(exclusionIntent?.type === "exclude-trains"
      ? exclusionIntent.exclusions.serviceUids
      : []),
  ]);
  const searchTimeMinutes =
    plan.searchTimeMinutes ??
    plan.journeys[0]?.departureTimeMinutes ??
    dependencies.getRouteTime();
  const response = await dependencies.searchDirectRoutes({
    originStation: plan.originStation,
    destinationStation: plan.destinationStation,
    departureTimeMinutes: searchTimeMinutes,
    ...(plan.serviceDate ? { serviceDate: plan.serviceDate } : {}),
    ...(plan.departureDate ? { departureDate: plan.departureDate } : {}),
    transferPace: guidance.transferPace,
    rankingPreference: guidance.rankingPreference,
    maxTransfers: guidance.maxTransfers,
    ...(excludedServiceTypes.length ? { excludedServiceTypes } : {}),
    ...(excludedTrainNames.length ? { excludedTrainNames } : {}),
    ...(excludedTrainNumbers.length ? { excludedTrainNumbers } : {}),
    ...(excludedServiceUids.length ? { excludedServiceUids } : {}),
    ...(guidance.requiredServiceTypes.length
      ? { requiredServiceTypes: guidance.requiredServiceTypes }
      : {}),
    ...(guidance.requiredTrainNames.length
      ? { requiredTrainNames: guidance.requiredTrainNames }
      : {}),
    ...(guidance.requiredTrainNumbers.length
      ? { requiredTrainNumbers: guidance.requiredTrainNumbers }
      : {}),
    ...(guidance.allowedServiceTypes.length
      ? { allowedServiceTypes: guidance.allowedServiceTypes }
      : {}),
  });
  const journeys = journeysFromSearchResponse(response);
  const state: DirectRouteToolState = {
    searched: true,
    response: {
      serviceDate: response.serviceDate ?? plan.serviceDate,
      departureDate: response.departureDate ?? plan.departureDate,
      transferPace:
        response.transferPace ??
        guidance.transferPace ??
        defaultJourneySearchPreferences.transferPace,
      rankingPreference:
        response.rankingPreference ??
        guidance.rankingPreference ??
        defaultJourneySearchPreferences.rankingPreference,
      maxTransfers:
        response.maxTransfers ??
        guidance.maxTransfers ?? supportedMaximumTransfers(plan.maxTransfers),
      excludedServiceTypes,
      excludedTrainNames,
      excludedTrainNumbers,
      excludedServiceUids,
      requiredServiceTypes: guidance.requiredServiceTypes,
      requiredTrainNames: guidance.requiredTrainNames,
      requiredTrainNumbers: guidance.requiredTrainNumbers,
      allowedServiceTypes: guidance.allowedServiceTypes,
      originStation: response.originStation,
      destinationStation: plan.destinationStation,
      searchTimeMinutes,
      journeys,
    },
  };
  const firstServiceUid = journeys[0]?.legs[0]?.serviceUid;
  if (firstServiceUid && dependencies.focusTrain(firstServiceUid)) {
    state.focusedServiceUid = firstServiceUid;
  }
  return directRouteResponseText(state);
}

function supportedMaximumTransfers(value: number | undefined): 0 | 1 | 2 | 3 {
  return value === 0 || value === 1 || value === 2 || value === 3
    ? value
    : defaultJourneySearchPreferences.maxTransfers;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function journeysFromSearchResponse(
  response: DirectRouteSearchResponse,
): NonNullable<DirectRouteToolState["response"]>["journeys"] {
  return response.journeys ?? response.results.map((route) => ({
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
