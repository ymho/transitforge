import type {
  BedrockAgentContentBlock,
  BedrockAgentMessage,
  BedrockAgentResponse,
  RepresentativeTimetableSearchMode,
  RepresentativeTimetableSearchResponse,
  RepresentativeTimetableKind,
} from "../http/agent-api/bedrock-agent";
import type { Train } from "@raiquora/train/train";
import type { CongestionAnalysisForAgent } from "../../domain/congestion-analysis";
import type { DelayAnalysisForAgent } from "../../domain/delay-analysis";
import type { WeatherMode } from "../../domain/weather";
import {
  defaultJourneySearchPreferences,
  journeySearchPreferencesFromPrompt,
  type JourneyRankingPreference,
  type JourneySearchPreferences,
  type TransferPace,
} from "@raiquora/journey/journey-search-preferences";
import { operatingDayRouteTime } from "../../domain/playback";
import { formatJapaneseRouteClockTime } from "@raiquora/train/route-time";
import { normalizeStationName } from "@raiquora/train/station-name";
import type { TrainPosition } from "../../domain/train-position";
import type {
  ViewerAgentJourneyPlan,
  ViewerAgentTravelPlan,
  ViewerAgentResponse,
  ViewerAgentTravelResponse,
  ViewerAgentTripPlanUpdateResponse,
} from "../../domain/viewer-agent-response";
import { adventureIntensityFromRequest } from "@raiquora/trip/adventure-safety";
import { journeyChatFollowUpIntent } from "../../domain/journey-chat-follow-up";
import {
  journeyNavigationGuidanceFromPrompt,
  mergeJourneyNavigationGuidance,
  type JourneyNavigationGuidance,
} from "../../domain/journey-navigation-intent";
import {
  directRouteDepartureTime,
  type DirectRouteSearchResponse,
} from "@raiquora/journey/direct-route-search";
import {
  parseViewerAgentActions,
  type ViewerAgentLayer,
} from "../../usecases/viewer/viewer-action";
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
} from "../../usecases/viewer/viewer-local-tools";
import {
  extendedStayDestinations,
  travelDestinationAccess,
} from "@raiquora/trip/travel-destination";
import {
  normalizedConversationGuidance,
  type ConversationExpectedInput,
  type ConversationGuidance,
} from "../../domain/conversation-guidance";
import {
  mergeAuthoritativeTripContext,
  quickReplyMatchesExpectedInput,
  travelConversationFacts,
} from "../../domain/travel-conversation-context";
import type { TripContext, UserProfile } from "@raiquora/trip/travel-profile";
import {
  tripPlanPatchesFromTravelPlan,
  validateTripPlanPatches,
  type MovementMode,
  type TripPlan,
  type TripPlanPatch,
  type TripPlanUpdateProposal,
} from "@raiquora/trip/trip-plan";
import type { ConversationScope } from "../../domain/conversation-session";
import { MultiStepAgentRuntime } from "../../usecases/agent/agent-runtime";
import { AgentToolRegistry } from "../../usecases/agent/tool-registry";
import { AgentToolExecutor } from "../../usecases/agent/agent-tool-executor";
import { ToolEvidenceRegistry } from "../../usecases/agent/tool-evidence-registry";
import { ToolViewerActionRegistry } from "../../usecases/agent/tool-viewer-action-registry";
import {
  failedAgentToolResult,
  invalidAgentToolInput,
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentTool,
  type AgentToolInputSchema,
} from "../../usecases/agent/tool-contract";
import type {
  AgentModelContent,
  AgentModelMessage,
  AgentModelProvider,
  AgentModelRequest,
  AgentModelResponse,
} from "../../usecases/agent/model-provider";
import type { AgentProblemFramer } from "../../usecases/agent/problem-framing";
import { ViewerActionExecutor } from "../../usecases/viewer/viewer-action-executor";
import { EvidenceScopedViewerActionHandler } from "../../usecases/agent/viewer-action-handler";
import type { Evidence } from "../../usecases/agent/evidence-model";
import type { AgentTrace } from "../../usecases/agent/agent-trace";
import {
  agentContextText,
  createAgentContextSnapshot,
} from "../../usecases/agent/agent-context-snapshot";
import {
  executeExternalTravelTool,
  externalTravelEvidence,
  externalTravelToolDescription,
  externalTravelToolInputSchema,
  externalTravelToolNames,
  hasExternalTravelInformation,
  isExternalTravelToolName,
  type ExternalTravelToolDependencies,
  type ExternalTravelToolState,
} from "../../usecases/agent/external-travel-tools";

export interface ViewerAgentRuntimeDependencies extends ExternalTravelToolDependencies {
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
  getUserProfile?: () => UserProfile | undefined;
  storeAgentTrace?: (trace: AgentTrace) => Promise<void>;
  maximumRouteTime: number;
}

export type BedrockAgentConverse = (
  messages: BedrockAgentMessage[],
  tools?: import("../../usecases/agent/tool-contract").AgentToolDescriptor[],
) => Promise<BedrockAgentResponse>;

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
export async function runViewerAgentRuntime(
  prompt: string,
  dependencies: ViewerAgentRuntimeDependencies,
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
  const searchableServiceUids = new Set<string>();
  const directRouteServiceUids = new Set<string>();
  const toolState: DirectRouteToolState = { searched: false };
  const travelState: TravelToolState = {};
  const conversationState: ConversationToolState = {};
  const tripPlanUpdateState: TripPlanUpdateToolState = {};
  const externalState: ExternalTravelToolState = {};
  const tools = viewerToolRegistry({
    prompt,
    dependencies,
    searchableServiceUids,
    directRouteServiceUids,
    toolState,
    travelState,
    conversationState,
    tripPlanUpdateState,
    externalState,
  });
  const evidenceMappers = viewerEvidenceMappers();
  const toolViewerActions = viewerToolActionMappers();
  const viewerActionHandler = new EvidenceScopedViewerActionHandler(
    new ViewerActionExecutor({
      setDisplayTime: dependencies.setRouteTime,
      focusTrain: dependencies.focusTrain,
      highlightRoute: () => false,
      compareJourneys: () => false,
      showEvidence: () => false,
      setWeather: dependencies.setWeather,
      setLayerVisibility: dependencies.setLayerVisibility,
    }, dependencies.maximumRouteTime),
  );
  const runtime = new MultiStepAgentRuntime({
    model: new ConverseModelProvider(converse),
    tools,
    toolExecutor: new AgentToolExecutor(tools, evidenceMappers),
    problemFramer: viewerProblemFramer(prompt, dependencies),
    viewerActionHandler,
    toolViewerActions,
    terminalToolResult: (toolName) => viewerTerminalResponseText(
      toolName,
      toolState,
      travelState,
      conversationState,
      tripPlanUpdateState,
      dependencies.getTripPlan?.(),
      dependencies.getUserProfile?.(),
    ),
    limits: {
      maxIterations: 6,
      maxModelCalls: 7,
      maxToolCalls: 12,
      // 広域グラフ検索はモデル呼び出しより長くなるため全体上限に余裕を持たせる
      maxExecutionMs: 45_000,
    },
  });
  const runtimeResult = await runtime.run({
    executionId: crypto.randomUUID(),
    feature: featureFromPrompt(prompt),
    userRequest: prompt,
  });
  await dependencies.storeAgentTrace?.(runtimeResult.trace).catch(() => undefined);

  const travelResponse = travelResponseText(
    travelState,
    dependencies.getTripPlan?.(),
    dependencies.getUserProfile?.(),
  );
  if (travelResponse !== undefined) {
    if (hasExternalTravelInformation(externalState) && "travelPlan" in travelResponse) {
      return { ...travelResponse, external: externalState };
    }
    return travelResponse;
  }
  const conversationResponse = conversationResponseText(conversationState);
  if (conversationResponse !== undefined) return conversationResponse;
  if (tripPlanUpdateState.proposal) {
    return {
      text: tripPlanUpdateState.proposal.summary,
      tripPlanUpdate: tripPlanUpdateState.proposal,
    };
  }
  if (hasExternalTravelInformation(externalState)) {
    return { text: runtimeResult.response, external: externalState };
  }
  return directRouteResponseText(toolState) ?? runtimeResult.response;
}

interface ViewerToolContext {
  prompt: string;
  dependencies: ViewerAgentRuntimeDependencies;
  searchableServiceUids: Set<string>;
  directRouteServiceUids: Set<string>;
  toolState: DirectRouteToolState;
  travelState: TravelToolState;
  conversationState: ConversationToolState;
  tripPlanUpdateState: TripPlanUpdateToolState;
  externalState: ExternalTravelToolState;
}

const viewerToolNames = [
  "propose_trip_update",
  "remember_travel_preference",
  "update_conversation_session",
  "ask_follow_up",
  "set_display_time",
  "search_trains",
  "search_train_arrivals",
  "search_direct_routes",
  "focus_train",
  "query_daily_congestion_analysis",
  "query_train_delay_analysis",
  "search_accommodations",
  ...externalTravelToolNames,
  "plan_day_trip",
  "search_trip_route_update",
  "search_representative_timetable",
  "set_weather",
  "set_layer_visibility",
] as const;

const terminalToolNames = new Set<string>([
  "propose_trip_update",
  "ask_follow_up",
  "search_direct_routes",
  "search_accommodations",
  "plan_day_trip",
  "search_trip_route_update",
]);

function viewerToolRegistry(context: ViewerToolContext): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  for (const name of viewerToolNames) {
    registry.register(viewerTool(name, context));
  }
  return registry;
}

function viewerTool(
  name: typeof viewerToolNames[number],
  context: ViewerToolContext,
): AgentTool<Record<string, unknown>, unknown> {
  return {
    name,
    description: viewerToolDescription(name),
    inputSchema: viewerToolInputSchema(name),
    parseInput(value) {
      return isRecord(value)
        ? validAgentToolInput(value)
        : invalidAgentToolInput("Tool入力はオブジェクトで指定してください");
    },
    async execute(input) {
      try {
        return successfulAgentToolResult(await executeViewerToolAdapter(
          name,
          input,
          context.prompt,
          context.dependencies,
          context.searchableServiceUids,
          context.directRouteServiceUids,
          context.toolState,
          context.travelState,
          context.conversationState,
          context.tripPlanUpdateState,
          context.externalState,
        ));
      } catch (error) {
        return failedAgentToolResult({
          code: "invalid_input",
          message: error instanceof Error
            ? error.message
            : "Toolを実行できませんでした",
          retryable: false,
        });
      }
    },
  };
}

function viewerToolDescription(name: typeof viewerToolNames[number]): string {
  if (isExternalTravelToolName(name)) return externalTravelToolDescription(name);
  const descriptions: Record<Exclude<typeof viewerToolNames[number], typeof externalTravelToolNames[number]>, string> = {
    propose_trip_update: "現在の旅程に対する観光 移動 滞在 条件の変更案を構造化します。利用者が変更を依頼し内容が明確なら追加確認せず使います",
    remember_travel_preference: "高確信の継続的な旅行の好みを端末内へ記憶します",
    update_conversation_session: "現在の会話Sessionの要約と話題を更新します",
    ask_follow_up: "旅行相談で本当に不足している今回固有の条件だけを構造化して質問します。プロフィールと現在の旅程にある条件は聞き直しません。負担条件を尋ねる場合は理由と代替案を添えます",
    set_display_time: "Viewerの計画ダイヤ表示時刻を変更します",
    search_trains: "現在表示中の列車を決定論的に検索します",
    search_train_arrivals: "指定駅へ指定時刻ごろ到着する列車を検索します",
    search_direct_routes: "自前の時刻表と運行情報で駅間の乗換を含む経路を検索します。観光地はそのアクセス駅を指定します",
    focus_train: "同じタスクで検索済みの列車へViewerを移動します",
    query_daily_congestion_analysis: "指定業務日付の観測済み混雑を分析します",
    query_train_delay_analysis: "指定業務日付の観測済み遅延を分析します",
    search_accommodations: "新しい宿泊旅行 日程変更 宿泊地変更 宿の再検索で指定日程の宿泊候補を検索します。観光相談 人数やペースだけの変更 経路の部分変更には使いません",
    plan_day_trip: "宿泊施設を検索せず 指定日の行きと帰りの鉄道経路を組み合わせて日帰り旅程を作ります",
    search_trip_route_update: "現在の旅程にある行きまたは帰りの鉄道移動を再検索します。出発を遅らせる変更と途中駅への立寄りに使います",
    search_representative_timetable: "平日または土休日の代表ダイヤを検索します",
    set_weather: "Viewerの天気表現を変更します",
    set_layer_visibility: "Viewerの混雑またはアーチ表示を変更します",
  };
  return descriptions[name];
}

function viewerToolInputSchema(
  name: typeof viewerToolNames[number],
): AgentToolInputSchema {
  if (isExternalTravelToolName(name)) return externalTravelToolInputSchema(name);
  if (name === "search_accommodations") {
    return {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "宿泊する地域または観光地。現在の旅程を変更する場合も省略しない",
        },
        checkInDate: {
          type: "string",
          description: "チェックイン日。YYYY-MM-DD形式",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        checkOutDate: {
          type: "string",
          description: "チェックアウト日。YYYY-MM-DD形式でcheckInDateより後",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        adults: { type: "integer", minimum: 1, maximum: 10 },
        children: { type: "integer", minimum: 0, maximum: 10 },
        considerations: {
          type: "array",
          maxItems: 8,
          items: { type: "string" },
        },
        limit: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["destination", "checkInDate", "checkOutDate"],
      additionalProperties: false,
    };
  }
  if (name === "plan_day_trip") {
    return {
      type: "object",
      properties: {
        destination: { type: "string" },
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "日帰り旅行の日付。YYYY-MM-DD形式",
        },
        outboundTimeMinutes: { type: "integer", minimum: 0, maximum: 1_800 },
        returnTimeMinutes: { type: "integer", minimum: 0, maximum: 1_800 },
      },
      required: ["destination", "date"],
      additionalProperties: false,
    };
  }
  if (name === "search_trip_route_update") {
    return {
      type: "object",
      properties: {
        target: { type: "string", enum: ["outbound", "return"] },
        departureTimeMinutes: { type: "integer", minimum: 0, maximum: 1_800 },
        stopoverStation: { type: "string" },
      },
      required: ["target"],
      additionalProperties: false,
    };
  }
  if (name === "search_direct_routes") {
    return {
      type: "object",
      properties: {
        originStation: {
          type: "string",
          description: "出発駅。省略時はプロフィールまたは端末の現在地から解決する",
        },
        destinationStation: {
          type: "string",
          description: "到着駅。観光地の場合は鉄道で到達するためのアクセス駅",
        },
        departureDate: {
          type: "string",
          description: "利用者が指定した出発日。YYYY-MM-DD形式",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        departureTimeMinutes: {
          type: "integer",
          minimum: 0,
          maximum: 1_800,
          description: "出発時刻。0時からの分数。未指定なら利用者の表現またはViewer時刻から決定する",
        },
      },
      required: ["destinationStation"],
      additionalProperties: false,
    };
  }
  if (name === "ask_follow_up") {
    return {
      type: "object",
      properties: {
        recommendation: {
          type: "string",
          description: "条件が不足していても先に示せる仮の旅行案。目的地相談ではプロフィールを踏まえた方向性を短く提案する",
        },
        reason: {
          type: "string",
          description: "この確認が必要な理由。経路や旅程の既知事実に基づき 利点と負担を短く説明する",
        },
        question: { type: "string" },
        expectedInput: {
          type: "string",
          enum: ["departure-date", "stay-length", "traveler-count", "free-text"],
        },
        quickReplies: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
            required: ["label", "value"],
            additionalProperties: false,
          },
        },
        tripContext: {
          type: "object",
          description: "既に判明している今回の旅行条件。質問していない条件も失わず引き継ぐ",
          properties: {
            destinationWish: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            stayNights: { type: "integer", minimum: 0, maximum: 30 },
            pace: { type: "number", minimum: 0, maximum: 1 },
            maximumTravelMinutes: { type: ["number", "null"] },
            carAvailable: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      required: ["question", "expectedInput", "quickReplies", "tripContext"],
      additionalProperties: false,
    };
  }
  if (name === "propose_trip_update") {
    return {
      type: "object",
      properties: {
        summary: { type: "string" },
        patches: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "object", additionalProperties: true },
        },
      },
      required: ["summary", "patches"],
      additionalProperties: false,
    };
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

function viewerEvidenceMappers(): ToolEvidenceRegistry {
  const registry = new ToolEvidenceRegistry();
  registry.register("search_direct_routes", routeEvidence);
  registry.register("search_trains", trainSearchEvidence);
  registry.register("search_train_arrivals", trainSearchEvidence);
  for (const name of externalTravelToolNames) {
    if (name !== "schedule_trip_recheck") registry.register(name, externalTravelEvidence);
  }
  return registry;
}

function routeEvidence(output: unknown, context: { retrievedAt: string }): Evidence[] {
  if (!isRecord(output) || !Array.isArray(output.journeys)) return [];
  return output.journeys.slice(0, 3).flatMap((journey, index) => {
    if (!isRecord(journey) || !Array.isArray(journey.legs)) return [];
    const serviceUids = journey.legs.flatMap((leg) =>
      isRecord(leg) && typeof leg.serviceUid === "string" ? [leg.serviceUid] : []);
    if (serviceUids.length === 0) return [];
    return [{
      id: `journey:${encodeURIComponent(String(output.serviceDate ?? "unknown"))}:${index}`,
      category: "journey" as const,
      knowledgeKind: "derived_value" as const,
      subject: `${String(output.originStation ?? "出発駅")}から${String(output.destinationStation ?? "到着駅")}の経路候補${index + 1}`,
      facts: { serviceUids },
      references: [{
        sourceType: "timetable-graph" as const,
        sourceRef: `${String(output.serviceDate ?? "unknown")}:journey-${index + 1}`,
        retrievedAt: context.retrievedAt,
        freshness: "scheduled" as const,
        summary: "自前の時刻表と運行情報で検索した経路",
      }],
    }];
  });
}

function trainSearchEvidence(output: unknown, context: { retrievedAt: string }): Evidence[] {
  if (!isRecord(output) || !Array.isArray(output.matches)) return [];
  return output.matches.slice(0, 5).flatMap((match) => {
    if (!isRecord(match) || typeof match.serviceUid !== "string") return [];
    return [{
      id: `train:${encodeURIComponent(match.serviceUid)}`,
      category: "train" as const,
      knowledgeKind: "deterministic_fact" as const,
      subject: String(match.trainNumber ?? match.serviceUid),
      facts: { serviceUid: match.serviceUid },
      references: [{
        sourceType: "timetable-index" as const,
        sourceRef: match.serviceUid,
        retrievedAt: context.retrievedAt,
        freshness: "current" as const,
        summary: "現在の表示時刻と列車indexによる検索結果",
      }],
    }];
  });
}

function viewerToolActionMappers(): ToolViewerActionRegistry {
  const registry = new ToolViewerActionRegistry();
  registry.register("set_display_time", (output) =>
    isRecord(output) && typeof output.routeTimeMinutes === "number"
      ? [{ type: "set_display_time", routeTimeMinutes: output.routeTimeMinutes }]
      : []);
  registry.register("focus_train", (output) =>
    isRecord(output) && typeof output.serviceUid === "string"
      ? [{ type: "focus_train", serviceUid: output.serviceUid }]
      : []);
  registry.register("search_direct_routes", (output) => {
    if (!isRecord(output) || !Array.isArray(output.journeys)) return [];
    const journey = output.journeys[0];
    const leg = isRecord(journey) && Array.isArray(journey.legs)
      ? journey.legs[0]
      : undefined;
    return isRecord(leg) && typeof leg.serviceUid === "string"
      ? [{ type: "focus_train", serviceUid: leg.serviceUid }]
      : [];
  });
  registry.register("set_weather", (output) =>
    isRecord(output) && ["clear", "cloudy", "rain", "snow"].includes(String(output.weather))
      ? [{ type: "set_weather", weather: output.weather as WeatherMode }]
      : []);
  registry.register("set_layer_visibility", (output) =>
    isRecord(output) &&
      (output.layer === "congestion" || output.layer === "destination_arcs") &&
      typeof output.visible === "boolean"
      ? [{ type: "set_layer_visibility", layer: output.layer, visible: output.visible }]
      : []);
  return registry;
}

function viewerProblemFramer(
  prompt: string,
  dependencies: ViewerAgentRuntimeDependencies,
): AgentProblemFramer {
  return {
    frame(request) {
      const context = agentContextText(createAgentContextSnapshot(
        dependencies.getUserProfile?.(),
        dependencies.getTripPlan?.(),
      ));
      const objective =
        (dependencies.conciergeInstruction === undefined
          ? ""
          : `コンシェルジュの会話方針:\n${dependencies.conciergeInstruction}\n\n`) +
        `利用者の依頼: ${prompt}\n` +
        (context === undefined ? "" : `${context}\n`) +
        `現在の表示時刻（0時からの分数）: ${dependencies.getRouteTime()}\n` +
        `今日の実日付（日本時間）: ${currentCalendarDateInJapan(currentDate(dependencies))}\n` +
        `現在の業務日付（日本時間4時切替）: ${currentServiceDateInJapan(currentDate(dependencies))}`;
      return {
        feature: request.feature,
        normalizedIntent: request.feature,
        objective,
        constraints: {
          ...(adventureIntensityFromRequest(prompt) === undefined ? {} : { adventureIntensity: adventureIntensityFromRequest(prompt) }),
        },
        missingInformation: prompt.trim() ? [] : ["user_request"],
      };
    },
  };
}

function featureFromPrompt(prompt: string): "journey_planning" | "train_guidance" | "operational_analysis" | "travel_planning" {
  const normalized = prompt.normalize("NFKC");
  if (/(?:旅行|観光|宿泊|\d+泊|ホテル|旅館)/u.test(normalized)) return "travel_planning";
  if (/(?:遅延|遅れ|混雑|ピーク)/u.test(normalized)) return "operational_analysis";
  if (/(?:から.+(?:へ|まで)|経路|乗換|行きたい)/u.test(normalized)) return "journey_planning";
  return "train_guidance";
}

class ConverseModelProvider implements AgentModelProvider {
  constructor(private readonly converse: BedrockAgentConverse) {}

  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    const response = await this.converse(
      request.messages.map(toBedrockMessage),
      request.tools,
    );
    return {
      message: fromBedrockMessage(response.message),
      stopReason: response.stopReason === "tool_use"
        ? "tool_calls"
        : response.stopReason === "max_tokens" ? "max_tokens" : "completed",
      metadata: {
        provider: "bedrock",
        model: response.metadata?.modelId,
        latencyMs: response.metadata?.latencyMs,
        usage: response.metadata?.usage,
      },
    };
  }
}

function toBedrockMessage(message: AgentModelMessage): BedrockAgentMessage {
  return { role: message.role, content: message.content.map(toBedrockContent) };
}

function toBedrockContent(content: AgentModelContent): BedrockAgentContentBlock {
  if (content.type === "text") return { text: content.text };
  if (content.type === "tool_call") {
    return { toolUse: { toolUseId: content.toolCallId, name: content.name, input: content.input } };
  }
  return {
    toolResult: {
      toolUseId: content.toolCallId,
      status: content.status,
      content: [{ json: content.output }],
    },
  };
}

function fromBedrockMessage(message: BedrockAgentMessage): AgentModelMessage {
  return { role: message.role, content: message.content.map(fromBedrockContent) };
}

function fromBedrockContent(content: BedrockAgentContentBlock): AgentModelContent {
  if ("text" in content) return { type: "text", text: content.text };
  if ("toolUse" in content) {
    return {
      type: "tool_call",
      toolCallId: content.toolUse.toolUseId,
      name: content.toolUse.name,
      input: content.toolUse.input,
    };
  }
  return {
    type: "tool_result",
    toolCallId: content.toolResult.toolUseId,
    status: content.toolResult.status,
    output: content.toolResult.content[0]?.json ?? null,
  };
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
        text: `直前の候補${journeyIndex + 1}では${formatStationLabel(leg.originStation)}を${formatJapaneseRouteClockTime(leg.departureTimeMinutes)}に発車する${serviceLabel}を利用し ${formatStationLabel(leg.destinationStation)}へ向かいます。`,
        journeyPlan: plan,
      };
    }
  }
  return undefined;
}

async function executeViewerToolAdapter(
  name: string,
  input: Record<string, unknown>,
  originalPrompt: string,
  dependencies: ViewerAgentRuntimeDependencies,
  searchableServiceUids: Set<string>,
  directRouteServiceUids: Set<string>,
  toolState: DirectRouteToolState,
  travelState: TravelToolState,
  conversationState: ConversationToolState,
  tripPlanUpdateState: TripPlanUpdateToolState,
  externalState: ExternalTravelToolState,
): Promise<unknown> {
  if (isExternalTravelToolName(name)) {
    return executeExternalTravelTool(name, input, dependencies, externalState);
  }
  if (name === "propose_trip_update") {
    const current = dependencies.getTripPlan?.();
    const summary = typeof input.summary === "string" ? input.summary.trim() : "";
    if (!current || !summary) throw new Error("変更する旅程がありません。");
    const patches = tripPlanPatchesFromToolInput(input.patches, current);
    if (patches.length === 0) throw new Error("旅程の変更内容がありません。");
    const validation = validateTripPlanPatches(current, patches);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "旅程の変更対象を確認できません。");
    }
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
    const guidance = conversationGuidanceFromToolInput(
      input,
      originalPrompt,
      currentDate(dependencies),
    );
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
    const travelFacts = travelConversationFacts(
      originalPrompt,
      currentDate(dependencies),
    );
    if (
      featureFromPrompt(originalPrompt) === "travel_planning" &&
      (!travelFacts.hasExplicitDate || !travelFacts.hasExplicitStayLength)
    ) {
      const guidance = missingTravelScheduleGuidance(
        originalPrompt,
        input,
        travelFacts.context,
        dependencies.getUserProfile?.(),
      );
      conversationState.response = guidance;
      return { searchDeferred: true, missing: guidance.expectedInput };
    }
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
      explicitOriginStationFromPrompt(originalPrompt, input.originStation) ??
      dependencies.getUserProfile?.()?.home.station;
    const requestedDestination =
      promptRequest?.destinationStation ?? input.destinationStation ??
      travelFacts.context.destinationWish;
    const destinationStation = typeof requestedDestination === "string"
      ? travelDestinationAccess(requestedDestination)?.accessStation ??
        requestedDestination
      : requestedDestination;
    if (
      typeof destinationStation !== "string" ||
      destinationStation.trim().length === 0 ||
      !dependencies.searchDirectRoutes
    ) {
      throw new Error("経路の検索条件が不正です。");
    }
    // The browser clock and the user's words are authoritative. A model-provided
    // minute value is intentionally not used for arithmetic or the current time.
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
    if (firstServiceUid) {
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
      action.type !== "focus_train"
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
    const travelFacts = travelConversationFacts(
      originalPrompt,
      currentDate(dependencies),
    );
    const destination = travelFacts.context.destinationWish ?? input.destination;
    if (
      !travelFacts.hasExplicitDate ||
      !travelFacts.hasExplicitStayLength ||
      !travelFacts.context.startDate ||
      !travelFacts.context.endDate
    ) {
      const guidance = missingTravelScheduleGuidance(
        originalPrompt,
        input,
        travelFacts.context,
        dependencies.getUserProfile?.(),
      );
      conversationState.response = guidance;
      return { searchDeferred: true, missing: guidance.expectedInput };
    }
    const checkInDate = travelFacts.context.startDate;
    const checkOutDate = travelFacts.context.endDate;
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
    if (dependencies.searchDirectRoutes) {
      const destinationStation = travelDestination?.accessStation ??
        stationForTravelDestination(destination, dependencies.trains);
      if (destinationStation) {
        const preferences = dependencies.getJourneySearchPreferences?.() ??
          defaultJourneySearchPreferences;
        const profileOriginStation = dependencies.getUserProfile?.()?.home.station;
        const outboundRequest = {
          ...(profileOriginStation ? { originStation: profileOriginStation } : {}),
          destinationStation,
          departureTimeMinutes: 8 * 60,
          departureDate: checkInDate,
          serviceDate: checkInDate,
          ...preferences,
        };
        const [outboundResult, parallelReturningResult] = profileOriginStation
          ? await Promise.all([
              dependencies.searchDirectRoutes(outboundRequest),
              dependencies.searchDirectRoutes({
                originStation: destinationStation,
                destinationStation: profileOriginStation,
                departureTimeMinutes: 10 * 60,
                departureDate: checkOutDate,
                serviceDate: checkOutDate,
                ...preferences,
              }),
            ])
          : [await dependencies.searchDirectRoutes(outboundRequest), undefined];
        const outbound = journeyPlanFromSearchResponse(outboundResult, {
          destinationStation,
          departureDate: checkInDate,
          searchTimeMinutes: 8 * 60,
          preferences,
        });
        const returningResult = parallelReturningResult === undefined
          ? await dependencies.searchDirectRoutes({
              originStation: destinationStation,
              destinationStation: outbound.originStation,
              departureTimeMinutes: 10 * 60,
              departureDate: checkOutDate,
              serviceDate: checkOutDate,
              ...preferences,
            })
          : parallelReturningResult;
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

  if (name === "plan_day_trip") {
    const destination = typeof input.destination === "string"
      ? input.destination.trim()
      : "";
    const date = typeof input.date === "string" ? input.date : "";
    if (!destination || !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
      !dependencies.searchDirectRoutes) {
      throw new Error("日帰り旅行の検索条件が不正です。");
    }
    const destinationStation = travelDestinationAccess(destination)?.accessStation ??
      stationForTravelDestination(destination, dependencies.trains);
    if (!destinationStation) {
      throw new Error("日帰り旅行の最寄り駅を判断できません。");
    }
    const preferences = dependencies.getJourneySearchPreferences?.() ??
      defaultJourneySearchPreferences;
    const originStation = dependencies.getUserProfile?.()?.home.station;
    const outboundTime = boundedInteger(input.outboundTimeMinutes, 0, 1_800) ??
      8 * 60;
    const returnTime = boundedInteger(input.returnTimeMinutes, 0, 1_800) ??
      17 * 60;
    const outboundResult = await dependencies.searchDirectRoutes({
      ...(originStation ? { originStation } : {}),
      destinationStation,
      departureTimeMinutes: outboundTime,
      departureDate: date,
      serviceDate: date,
      ...preferences,
    });
    const outbound = journeyPlanFromSearchResponse(outboundResult, {
      destinationStation,
      departureDate: date,
      searchTimeMinutes: outboundTime,
      preferences,
    });
    const returningResult = await dependencies.searchDirectRoutes({
      originStation: destinationStation,
      destinationStation: outbound.originStation,
      departureTimeMinutes: returnTime,
      departureDate: date,
      serviceDate: date,
      ...preferences,
    });
    travelState.response = {
      destination,
      dayTrip: true,
      checkInDate: date,
      checkOutDate: date,
      outbound,
      returning: journeyPlanFromSearchResponse(returningResult, {
        originStation: destinationStation,
        destinationStation: outbound.originStation,
        departureDate: date,
        searchTimeMinutes: returnTime,
        preferences,
      }),
      accommodations: [],
    };
    return { planned: true, destination, date };
  }

  if (name === "search_trip_route_update") {
    const current = dependencies.getTripPlan?.();
    const target = input.target === "outbound" || input.target === "return"
      ? input.target
      : undefined;
    const movement = current?.items.find((item) =>
      item.id === target && item.type === "movement" && item.mode === "rail");
    if (!current || !target || !movement || movement.type !== "movement" ||
      movement.mode !== "rail" || !dependencies.searchDirectRoutes) {
      throw new Error("変更する鉄道移動を特定できません。");
    }
    const route = movement.route;
    const departureDate = route.departureDate;
    if (!departureDate) throw new Error("変更する鉄道移動の日付がありません。");
    const preferences = dependencies.getJourneySearchPreferences?.() ??
      defaultJourneySearchPreferences;
    const currentDeparture = route.journeys[0]?.departureTimeMinutes ??
      route.searchTimeMinutes ?? 8 * 60;
    const departureTime = boundedInteger(input.departureTimeMinutes, 0, 1_800) ??
      currentDeparture;
    const stopover = typeof input.stopoverStation === "string" &&
      input.stopoverStation.trim() ? input.stopoverStation.trim() : undefined;
    const firstDestination = stopover ?? route.destinationStation;
    const firstResult = await dependencies.searchDirectRoutes({
      originStation: route.originStation,
      destinationStation: firstDestination,
      departureTimeMinutes: departureTime,
      departureDate,
      serviceDate: departureDate,
      ...preferences,
    });
    const firstPlan = journeyPlanFromSearchResponse(firstResult, {
      originStation: route.originStation,
      destinationStation: firstDestination,
      departureDate,
      searchTimeMinutes: departureTime,
      preferences,
    });
    const patches: TripPlanPatch[] = [{
      type: "replace",
      itemId: target,
      item: { id: target, type: "movement", mode: "rail", route: firstPlan },
    }];
    if (stopover) {
      const stopoverDeparture = (firstPlan.journeys[0]?.arrivalTimeMinutes ??
        departureTime) + 30;
      const secondResult = await dependencies.searchDirectRoutes({
        originStation: stopover,
        destinationStation: route.destinationStation,
        departureTimeMinutes: stopoverDeparture,
        departureDate,
        serviceDate: departureDate,
        ...preferences,
      });
      patches.push({
        type: "add",
        item: {
          id: `${target}-after-stopover-${crypto.randomUUID()}`,
          type: "movement",
          mode: "rail",
          route: journeyPlanFromSearchResponse(secondResult, {
            originStation: stopover,
            destinationStation: route.destinationStation,
            departureDate,
            searchTimeMinutes: stopoverDeparture,
            preferences,
          }),
        },
        afterId: target,
      });
    }
    const summary = stopover
      ? `${target === "return" ? "帰り" : "行き"}に${stopover}への立寄りを追加`
      : `${target === "return" ? "帰り" : "行き"}の出発を${formatJapaneseRouteClockTime(departureTime)}以降へ変更`;
    tripPlanUpdateState.proposal = { summary, patches };
    return { proposed: true, summary };
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
  const normalizedPrompt = normalizeStationName(prompt);
  const normalizedCandidate = normalizeStationName(candidate);
  return normalizedCandidate && normalizedPrompt.includes(normalizedCandidate)
    ? candidate
    : undefined;
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
): ViewerAgentTravelResponse | ViewerAgentTripPlanUpdateResponse | undefined {
  const plan = state.response;
  if (!plan) return undefined;
  const advisory = travelBurdenAdvisory(plan, profile);
  const stayAdvisory = extendedStayAdvisory(plan);
  if (plan.dayTrip) {
    if (currentPlan) {
      return {
        text: `${formatCalendarDate(plan.checkInDate)}の${plan.destination}日帰り旅行へ組み直しました。${advisory}変更内容を確認してください。`,
        tripPlanUpdate: {
          summary: `${formatCalendarDate(plan.checkInDate)}の${plan.destination}日帰り旅行へ変更`,
          patches: tripPlanPatchesFromTravelPlan(plan),
        },
      };
    }
    return {
      text: `${formatCalendarDate(plan.checkInDate)}の${plan.destination}日帰り旅行です。${advisory}行きと帰りの経路をまとめました。`,
      travelPlan: plan,
    };
  }
  if (currentPlan) {
    return {
      text: `${formatCalendarDate(plan.checkInDate)}から${formatCalendarDate(plan.checkOutDate)}へ日程と経路を組み直しました。${advisory}${stayAdvisory}変更内容を確認してください。`,
      tripPlanUpdate: {
        summary: `${formatCalendarDate(plan.checkInDate)}から${formatCalendarDate(plan.checkOutDate)}の日程へ変更`,
        patches: tripPlanPatchesFromTravelPlan(plan),
      },
    };
  }
  return {
    text: `${formatCalendarDate(plan.checkInDate)}から${formatCalendarDate(plan.checkOutDate)}までの${plan.destination}旅行です。${advisory}${stayAdvisory}行きと帰りの経路、宿泊候補をまとめました。`,
    travelPlan: plan,
  };
}

function viewerTerminalResponseText(
  toolName: string,
  directRouteState: DirectRouteToolState,
  travelState: TravelToolState,
  conversationState: ConversationToolState,
  tripPlanUpdateState: TripPlanUpdateToolState,
  currentPlan?: TripPlan,
  profile?: UserProfile,
): string | undefined {
  if (!terminalToolNames.has(toolName)) return undefined;

  const travelResponse = travelResponseText(travelState, currentPlan, profile);
  if (travelResponse) return travelResponse.text;

  const conversationResponse = conversationResponseText(conversationState);
  if (typeof conversationResponse !== "string" && conversationResponse) {
    return conversationResponse.text;
  }

  if (tripPlanUpdateState.proposal) {
    return tripPlanUpdateState.proposal.summary;
  }

  const directRouteResponse = directRouteResponseText(directRouteState);
  return typeof directRouteResponse === "string"
    ? directRouteResponse
    : directRouteResponse?.text;
}

function extendedStayAdvisory(plan: ViewerAgentTravelPlan): string {
  if (plan.dayTrip) return "";
  const nights = calendarDayDifference(plan.checkInDate, plan.checkOutDate);
  if (nights < 3) return "";
  const alternatives = extendedStayDestinations(plan.destination);
  const suggestion = alternatives.length > 0
    ? `${alternatives.join("や")}へ滞在先を分ける相談もできます。`
    : "別の地域へ滞在先を分ける相談もできます。";
  return `宿泊候補は${nights}泊を同じ地域で過ごす前提です。${suggestion}`;
}

function calendarDayDifference(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  return Math.max(0, Math.round((endTime - startTime) / 86_400_000));
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
  return {
    text: [
      state.response.recommendation,
      state.response.reason,
      state.response.question,
    ].filter((value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index
    ).join("\n\n"),
    conversation: state.response,
  };
}

function conversationGuidanceFromToolInput(
  input: Record<string, unknown>,
  originalPrompt: string,
  now: Date,
): ConversationGuidance {
  const question = typeof input.question === "string" ? input.question : "";
  if (!question.trim()) {
    throw new Error("次の質問が必要です。");
  }
  const requestedExpectedInput = isConversationExpectedInput(input.expectedInput)
    ? input.expectedInput
    : "free-text";
  const candidateContext = tripContextFromToolInput(input.tripContext);
  const tripContext = mergeAuthoritativeTripContext(
    candidateContext,
    originalPrompt,
    now,
  );
  const facts = travelConversationFacts(originalPrompt, now);
  const expectedInput = featureFromPrompt(originalPrompt) === "travel_planning" &&
      !facts.hasExplicitDate
    ? "departure-date"
    : featureFromPrompt(originalPrompt) === "travel_planning" &&
        !facts.hasExplicitStayLength
      ? "stay-length"
      : requestedExpectedInput;
  const quickReplies = (Array.isArray(input.quickReplies)
    ? input.quickReplies.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const reply = value as Record<string, unknown>;
      if (typeof reply.label !== "string" || typeof reply.value !== "string") return [];
      return [{ label: reply.label, value: reply.value }];
    })
    : []).filter(({ value }) => quickReplyMatchesExpectedInput(value, expectedInput));
  const normalizedQuestion = expectedInput === "departure-date" &&
      /(?:泊|滞在日数)/u.test(question)
    ? "いつ出発しますか？"
    : expectedInput === "stay-length" && /(?:出発日|いつ.*出発)/u.test(question)
      ? "何泊にしますか？"
      : question;
  return normalizedConversationGuidance({
    ...(typeof input.recommendation === "string" && input.recommendation.trim()
      ? { recommendation: input.recommendation.trim().slice(0, 800) }
      : {}),
    ...(typeof input.reason === "string" && input.reason.trim()
      ? { reason: input.reason.trim().slice(0, 240) }
      : {}),
    question: normalizedQuestion,
    expectedInput,
    quickReplies,
    tripContext,
  });
}

function missingTravelScheduleGuidance(
  prompt: string,
  input: Record<string, unknown>,
  knownContext: TripContext,
  profile?: UserProfile,
): ConversationGuidance {
  const requestedDestination = knownContext.destinationWish ??
    (typeof input.destination === "string" ? input.destination.trim() : undefined) ??
    (typeof input.destinationStation === "string"
      ? input.destinationStation.trim()
      : undefined);
  const destination = travelDestinationAccess(prompt)?.name ??
    travelDestinationAccess(requestedDestination ?? "")?.name ??
    requestedDestination ?? "行き先";
  const context = { ...knownContext, destinationWish: destination };
  const active = (profile?.travelStyle.pace ?? context.pace ?? 0.5) >= 0.7;
  const recommendation = `${destination}なら、まずは1泊を基準にして、${
    active ? "見どころをいくつか巡りつつ" : "予定を詰め込みすぎず"
  }現地らしさを楽しめる形から考えるのがおすすめです。`;
  if (!context.startDate) {
    return normalizedConversationGuidance({
      recommendation,
      reason: "日付が決まれば、実際の列車と宿泊候補を同じ日程で確認できます。",
      question: "いつ出発しますか？",
      expectedInput: "departure-date",
      quickReplies: [
        { label: "今日", value: "今日" },
        { label: "明日", value: "明日" },
      ],
      tripContext: context,
    });
  }
  return normalizedConversationGuidance({
    recommendation,
    reason: "滞在日数が決まれば、帰りの経路と宿泊日を揃えて確認できます。",
    question: "何泊にしますか？",
    expectedInput: "stay-length",
    quickReplies: [
      { label: "日帰り", value: "日帰り" },
      { label: "1泊", value: "1泊" },
      { label: "2泊", value: "2泊" },
    ],
    tripContext: context,
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
    ...(boundedInteger(input.stayNights, 0, 30) === undefined
      ? {}
      : { stayNights: boundedInteger(input.stayNights, 0, 30) }),
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
  return !normalized.includes("日帰り") &&
    /(?:\d+泊|泊まり|宿泊|ホテル|旅館)/u.test(normalized);
}

function stationForTravelDestination(
  destination: string,
  trains: Train[],
): string | undefined {
  const normalizedDestination = normalizeStationName(destination);
  const stations = new Set(trains.flatMap((train) => [
    train.origin_station,
    train.destination_station,
    ...train.stops.flatMap((stop) => stop.station_name ? [stop.station_name] : []),
  ]).map((station) => station.replace(/駅$/u, "")));
  return [...stations].find((station) =>
    normalizeStationName(station) === normalizedDestination,
  ) ?? [...stations].find((station) =>
    normalizeStationName(station).startsWith(normalizedDestination),
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
    return `${exclusionLabel}${requirementLabel}${formatJapaneseRouteClockTime(response.searchTimeMinutes)}以降に${formatStationLabel(response.originStation)}から${formatStationLabel(response.destinationStation)}へ行く経路は見つかりませんでした。`;
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
  dependencies: ViewerAgentRuntimeDependencies,
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

function currentTrains(dependencies: ViewerAgentRuntimeDependencies): Train[] {
  return dependencies.getTrains?.() ?? dependencies.trains;
}

function currentDate(dependencies: ViewerAgentRuntimeDependencies): Date {
  return dependencies.getCurrentDate?.() ?? new Date();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
