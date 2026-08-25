import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./viewer.css";
import { browserDigitalTwinClockEnvironment } from "./adapters/browser/digital-twin-clock-environment";
import { browserPollingEnvironment } from "./adapters/browser/polling-controller";
import { applyWeather } from "./adapters/mapbox/map-weather";
import {
  congestionRefreshIntervalMilliseconds,
  congestionRetryIntervalMilliseconds,
  loadTrainCongestion,
} from "./adapters/http/traffic/train-congestion";
import {
  loadTrainDelays,
  trainDelayRefreshIntervalMilliseconds,
  trainDelayRetryIntervalMilliseconds,
} from "./adapters/http/traffic/train-delay";
import {
  loadPathCatalog,
  toRouteFeatureCollections,
} from "./adapters/http/viewer-input/path-catalog";
import { emptyStationLineCatalog } from "./adapters/http/viewer-input/station-line-catalog";
import {
  invokeBedrockAgent,
  queryDailyCongestionAnalysis,
  queryTrainDelayAnalysis,
  searchAccommodations,
  searchRepresentativeTimetable,
  journeySearchService,
  submitConversationFeedback,
} from "./adapters/http/agent-api/bedrock-agent";
import { loadTrainIndex } from "./adapters/http/viewer-input/train-index";
import type { StationCoordinate } from "./domain/rail/station";
import type { Train } from "./domain/rail/train";
import type { TrainDelaySnapshot, TrainOperation } from "./domain/rail/operation";
import {
  nearestOriginWithDepartures, searchDirectRoutes,
  type JourneyRouteLeg,
  type DirectRouteSearchHandler,
} from "./domain/direct-route-search";
import {
  alternativeProposalResponse,
  appliedAlternativeResponse,
  applyJourneyLegAlternative,
  intermediateStopsResponse,
  journeyChatFollowUpIntent,
  type JourneyLegAlternativeSearch,
  type PendingJourneyLegChange,
} from "./domain/journey-chat-follow-up";
import {
  journeyNavigationGuidanceFromPrompt,
  journeyNavigationGuidanceResponse,
  mergeJourneyNavigationGuidance,
  unsupportedJourneyExperienceFromPrompt,
  unsupportedJourneyExperienceResponse,
  type JourneyNavigationGuidance,
} from "./domain/journey-navigation-intent";
import { journeyLegAlternativeFits } from "./domain/journey-leg-alternative";
import {
  dateForOperatingRouteTime,
  operatingServiceDateStart,
  stepDisplayDateTime,
} from "./domain/display-date-time";
import {
  lightPresetForRouteTime,
  uiColorModeForLightPreset,
  type LightPreset,
} from "./domain/map-lighting";
import type { WeatherMode } from "./domain/weather";
import { dominantLineColorsByPathId } from "./domain/path-line-colors";
import { currentRouteTime } from "./domain/playback";
import { congestionAnalysisForAgent } from "./domain/congestion-analysis";
import { delayAnalysisForAgent } from "./domain/delay-analysis";
import {
  coupledTrainLayouts,
  trainHitTargetsFor,
} from "./domain/coupled-train-layout";
import { TrainLineColorIndex } from "./domain/train-line-color";
import { trainFormationLinks } from "./domain/train-formation-link";
import {
  delayByTrainNumber,
  destinationChangedServiceUids,
  operationsForDisplay,
  operationsWithCoupledTrainOperations,
  operationsWithTimetableTrainNumberAliases,
  trainsForOperations,
} from "./domain/train-operation-state";
import {
  activeTrainPositions,
  destinationCoordinateForTrain,
  freezeLongTimeStoppingPositions,
  PathGeometryIndex,
} from "./domain/train-position";
import type { TrainPosition } from "./domain/train-position";
import {
  type ViewerAgentLayer,
} from "./application/viewer/viewer-action";
import { AgentTraceRecorder } from "./application/agent/agent-trace";
import { ViewerActionExecutor } from "./application/viewer/viewer-action-executor";
import { ViewerActionTaskScope } from "./application/viewer/viewer-action-policy";
import { loadViewerElements } from "./application/viewer/viewer-elements";
import { resolveViewerDisplayMode } from "./domain/viewer-display-mode";
import { runBedrockViewerAgent } from "./adapters/bedrock/legacy-viewer-agent";
import { createLocalViewerAgent } from "./application/viewer-agent/viewer-agent-local";
import {
  directRouteRequestFromPrompt,
  isUsableOriginStation,
} from "./application/viewer-agent/viewer-agent-local-tools";
import type { ViewerAgentJourneyPlan } from "./domain/viewer-agent-response";
import {
  configureAiGuidePanel,
  type AiGuidePromptHandler,
} from "./features/concierge/presentation/ai-guide-panel";
import { configureLandmarkJourneyInteraction } from "./features/concierge/presentation/landmark-journey-interaction";
import { configureTrainSelection } from "./features/train-viewer/presentation/train-selection-controller";
import { trainTitleFor } from "./features/train-viewer/presentation/train-title";
import {
  configureTrainCongestionUpdates,
  configureTrainDelayUpdates,
} from "./features/train-viewer/realtime-updates";
import {
  configureDateTimeInput,
  maximumRouteTimeFor,
  renderDisplayDateTime,
} from "./features/train-viewer/date-time-control";
import {
  configurePlayback,
  configurePlaybackSpeed,
  type PlaybackUiController,
} from "./features/train-viewer/playback-controls";
import {
  configureDestinationArcs,
  configureWeather,
  renderDisplayMode,
} from "./features/train-viewer/map-controls";
import { createLoadingScreen } from "./presentation/loading-screen";
import { MapboxThreeTrainLayer } from "./rendering/mapbox-three-train-layer";
import { RuntimeMetrics } from "./observability/runtime-metrics";
import { configureTravelProfile } from "./features/concierge/presentation/travel-profile-panel";
import {
  buildConciergePrompt,
  selectConciergeForUserProfile,
} from "./features/concierge";
import { loadUserProfile, travelProfileChangedEvent } from "./domain/travel-profile";
import { promptWithConversationContext } from "./domain/conversation-guidance";
import { renderConciergeIdentity } from "./features/concierge/presentation/concierge-identity";
import { configureConversationHistoryPanel } from "./features/concierge/presentation/conversation-history-panel";
import { configureTripPlanPanel } from "./features/trip-plan/presentation/trip-plan-panel";
import { loadTripPlan, tripPlanFromTravelPlan } from "./domain/trip-plan";
import {
  conversationContextSummary,
  loadTravelMemories,
  rememberTravelPreference,
} from "./domain/conversation-session";
import {
  browserConversationSessionStorageEvents,
  LocalConversationSessionRepository,
} from "./adapters/browser/conversation-session-repository";
import { LocalConversationHistoryRepository } from "./adapters/browser/conversation-history-repository";
import { recentConversationContext } from "./domain/conversation-history";

const metricsLogIntervalMilliseconds = 10_000;
let nextMetricsLogTimestamp = 0;

const realtimeUpdateDependencies = {
  pollingEnvironment: browserPollingEnvironment,
  loadCongestion: loadTrainCongestion,
  congestionRefreshIntervalMilliseconds,
  congestionRetryIntervalMilliseconds,
  loadDelays: loadTrainDelays,
  delayRefreshIntervalMilliseconds: trainDelayRefreshIntervalMilliseconds,
  delayRetryIntervalMilliseconds: trainDelayRetryIntervalMilliseconds,
};

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const {
  app,
  loadingScreenElement,
  loadingScreenMessage,
  loadingScreenRetry,
  status,
  displayTime,
  dateTimeInput,
  dateTimeDate,
  dateTimeClock,
  playToggle,
  currentTimeButton,
  playbackSpeed,
  playbackSpeedMenuToggle,
  playbackSpeedOptions,
  playbackSpeedButtons,
  mapTools,
  weatherButtons,
  weatherMenuToggle,
  weatherOptions,
  congestionToggle,
  destinationArcsToggle,
  digitalTwinModeToggle,
  aiGuidePanel,
  aiGuideToggle,
  closeAiGuide,
  aiGuideMessages,
  aiGuideForm,
  aiGuideInput,
  aiGuideSubmit,
  conciergeAvatar,
  conciergeName,
  conciergeRole,
  newConversation,
  conversationHistoryToggle,
  conversationHistoryDialog,
  closeConversationHistory,
  conversationHistoryList,
  conversationHistoryEmpty,
  aiGuideSuggestions,
  aiGuideContextChoices,
  journeySettingsToggle,
  journeySettingsPanel,
  journeyTransferPace,
  journeyRankingPreference,
  tripPlanToggle,
  tripPlanPanel,
  tripPlanContent,
  closeTripPlan,
  trainDetails,
  closeTrainDetails,
  selectedTrainTitle,
  selectedTrainDelay,
  selectedTrainStopping,
  selectedTrainStops,
  trainDetailTabs,
} = loadViewerElements(document);
const dateTimeDisplayElements = {
  input: dateTimeInput,
  date: dateTimeDate,
  clock: dateTimeClock,
};
const metrics = new RuntimeMetrics();

const loadingScreen = createLoadingScreen({
  app,
  screen: loadingScreenElement,
  message: loadingScreenMessage,
  retry: loadingScreenRetry,
});
loadingScreenRetry.addEventListener("click", () => window.location.reload());

let handleAiGuidePrompt: AiGuidePromptHandler = async () =>
  "列車データを読み込んでいます。準備が整ってからもう一度お試しください。";
let findJourneyLegAlternatives: JourneyLegAlternativeSearch = async () => [];
let activeConcierge = selectConciergeForUserProfile(
  loadUserProfile(localStorage),
);
const conversationSessionRepository = new LocalConversationSessionRepository(
  localStorage,
  browserConversationSessionStorageEvents(),
);
const conversationHistoryRepository = new LocalConversationHistoryRepository(localStorage);
const activeConversationSession = conversationSessionRepository.active() ??
  conversationSessionRepository.create();
const updateConciergeIdentity = (resetGreeting = false) => {
  activeConcierge = selectConciergeForUserProfile(loadUserProfile(localStorage));
  renderConciergeIdentity(
    {
      avatar: conciergeAvatar,
      name: conciergeName,
      role: conciergeRole,
      messages: aiGuideMessages,
    },
    activeConcierge,
    resetGreeting,
  );
};
const currentConciergeInstruction = (prompt: string) => [
  buildConciergePrompt(activeConcierge).slice(0, 450),
  "この文脈は明示希望を上書きしない。既知の条件を聞き直さず、推測に確信がないときだけ短く確認する。遠い移動や多い乗換はプロフィールの許容度と照合し、懸念と代替案を先に示す。",
  `利用者と旅行の現在の文脈:\n${conversationContextSummary(
    loadUserProfile(localStorage),
    loadTripPlan(localStorage, activeConversationSession.id),
    activeConversationSession,
    loadTravelMemories(localStorage),
  )}`,
  `現在のセッションの直近の会話:\n${recentConversationContext(
    conversationHistoryRepository.list(activeConversationSession.id),
    prompt,
  )}`,
].join("\n\n").slice(0, 2_350);
updateConciergeIdentity(true);
document.addEventListener(travelProfileChangedEvent, () =>
  updateConciergeIdentity(true));
let aiGuideController: ReturnType<typeof configureAiGuidePanel>;
const tripPreviewEnabled = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("trip-preview") === "1";
const tripPlanController = configureTripPlanPanel(
  tripPlanPanel,
  tripPlanContent,
  closeTripPlan,
  tripPlanToggle,
  activeConversationSession.id,
  (prompt) => aiGuideController.ask(prompt),
  localStorage,
);
const sessionTripPlan = loadTripPlan(localStorage, activeConversationSession.id);
if (sessionTripPlan && activeConversationSession.tripPlanId !== sessionTripPlan.id) {
  Object.assign(activeConversationSession, {
    scope: "trip",
    tripPlanId: sessionTripPlan.id,
    updatedAt: new Date().toISOString(),
  });
  conversationSessionRepository.save(activeConversationSession);
}
aiGuideController = configureAiGuidePanel(
  {
    conversationSessionId: activeConversationSession.id,
    panel: aiGuidePanel,
    toggle: aiGuideToggle,
    close: closeAiGuide,
    messages: aiGuideMessages,
    form: aiGuideForm,
    input: aiGuideInput,
    submit: aiGuideSubmit,
    suggestions: aiGuideSuggestions,
    contextChoices: aiGuideContextChoices,
    settingsToggle: journeySettingsToggle,
    settingsPanel: journeySettingsPanel,
    transferPace: journeyTransferPace,
    rankingPreference: journeyRankingPreference,
    storage: localStorage,
    historyRepository: conversationHistoryRepository,
    submitFeedback: submitConversationFeedback,
    onFirstPrompt: (prompt) => {
      if (activeConversationSession.title !== "新しい会話") return;
      const renamed = conversationSessionRepository.rename(
        activeConversationSession.id,
        prompt.slice(0, 32),
      );
      if (renamed) Object.assign(activeConversationSession, renamed);
    },
    onTravelPlan: (plan) => {
      const tripPlan = tripPlanFromTravelPlan(plan);
      tripPlanController.show(tripPlan);
      Object.assign(activeConversationSession, {
        scope: "trip",
        tripPlanId: tripPlan.id,
        updatedAt: new Date().toISOString(),
      });
      conversationSessionRepository.save(activeConversationSession);
    },
    onTripPlanUpdate: (proposal) => {
      tripPlanController.apply(proposal.patches);
      Object.assign(activeConversationSession, {
        scope: "trip",
        summary: proposal.summary,
        updatedAt: new Date().toISOString(),
      });
      conversationSessionRepository.save(activeConversationSession);
    },
  },
  (prompt, preferences, conversation, onResponseMetadata) =>
    handleAiGuidePrompt(
      promptWithConversationContext(prompt, conversation),
      preferences,
      undefined,
      onResponseMetadata,
    ),
);
configureConversationHistoryPanel({
  newConversation,
  toggle: conversationHistoryToggle,
  dialog: conversationHistoryDialog,
  close: closeConversationHistory,
  list: conversationHistoryList,
  empty: conversationHistoryEmpty,
  storage: localStorage,
  repository: conversationSessionRepository,
  onSessionSelected: () => window.location.reload(),
});
configureTravelProfile(document, localStorage, () => aiGuideController.open());
if (tripPreviewEnabled) {
  loadingScreen.complete();
  document.querySelector<HTMLDialogElement>("#travel-profile-dialog")?.close();
  void import("./dev/trip-plan-preview").then(({ tripPlanPreview }) =>
    tripPlanController.showPreview(tripPlanPreview));
}

const initialDateTime = new Date();
let displayedServiceDateStart = operatingServiceDateStart(initialDateTime);
const initialRouteTime = currentRouteTime(initialDateTime);
app.dataset.uiColorMode = uiColorModeForLightPreset(
  lightPresetForRouteTime(initialRouteTime),
);
displayTime.value = String(initialRouteTime);
renderDisplayDateTime(dateTimeDisplayElements, initialDateTime);

if (!token) {
  const missingTokenMessage =
    "Mapbox公開トークンがありません。.env.localにVITE_MAPBOX_ACCESS_TOKENを設定してください。";
  status.textContent = missingTokenMessage;
  loadingScreen.fail(missingTokenMessage);
} else {
  mapboxgl.accessToken = token;

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/standard",
    config: {
      basemap: {
        // 地図を抑えた背景へ寄せ、半透明の操作面と路線色を主役にする。
        theme: "faded",
        show3dObjects: true,
        showPointOfInterestLabels: false,
        showPlaceLabels: false,
        showRoadLabels: false,
        showTransitLabels: false,
        showLandmarkIcons: true,
        showLandmarkIconLabels: true,
      },
    },
    language: "ja",
    center: [135.4959, 34.7025],
    zoom: 15.5,
    // 日本列島を広く見渡せる一方、地球儀へ遷移して3D表示が浮いて見える縮尺は避ける。
    minZoom: 5.5,
    pitch: 62,
    bearing: -18,
    antialias: true,
  });

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }));
  const geolocateControl = new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    fitBoundsOptions: { maxZoom: 16 },
    trackUserLocation: false,
    showAccuracyCircle: true,
    showUserHeading: true,
  });
  map.addControl(geolocateControl);
  const geolocateButton = document.querySelector<HTMLButtonElement>(
    ".mapboxgl-ctrl-geolocate",
  );
  if (geolocateButton) {
    geolocateButton.ariaLabel = "現在地へ移動";
    geolocateButton.title = "現在地へ移動";
  }
  map.addControl(
    {
      onAdd: () => mapTools,
      onRemove: () => mapTools.remove(),
    },
    "top-right",
  );
  map.addControl(
    {
      onAdd: () => {
        const control = document.createElement("div");
        control.className = "ai-guide-control mapboxgl-ctrl";
        control.append(aiGuideToggle);
        return control;
      },
      onRemove: () => aiGuideToggle.remove(),
    },
    "top-right",
  );

  let disposeDataUpdates = () => undefined;
  map.on("style.load", async () => {
    disposeDataUpdates();
    disposeDataUpdates = () => undefined;
    status.hidden = false;
    loadingScreen.setMessage("地図の表示を整えています。");
    map.setConfigProperty("basemap", "show3dObjects", true);
    map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
    map.setConfigProperty("basemap", "showPlaceLabels", false);
    map.setConfigProperty("basemap", "showRoadLabels", false);
    // Mapbox Standardでは空港だけを除外できないため、空港を含む交通ラベル群を隠す。
    // TransitForgeが描画する路線・列車・詳細表示には影響しない。
    map.setConfigProperty("basemap", "showTransitLabels", false);
    map.setConfigProperty("basemap", "showLandmarkIcons", true);
    map.setConfigProperty("basemap", "showLandmarkIconLabels", true);
    configureLandmarkJourneyInteraction(map, aiGuideController.openLandmarkJourney);
    let applyWeatherToTrains: (mode: WeatherMode) => void = () => undefined;
    let activeWeatherMode: WeatherMode = "clear";
    const selectWeather = configureWeather(
      map,
      weatherButtons,
      weatherMenuToggle,
      weatherOptions,
      (mode) => {
        activeWeatherMode = mode;
        applyWeatherToTrains(mode);
      },
      applyWeather,
    );
    monitorFrames();
    let activeLightPreset: LightPreset | undefined;

    try {
      status.textContent = "全経路を読み込んでいます。";
      loadingScreen.setMessage("鉄道路線を読み込んでいます。");
      const routeLoadStartedAt = performance.now();
      const catalog = await loadPathCatalog();
      metrics.recordRouteLoad(performance.now() - routeLoadStartedAt);
      logMetrics();

      status.textContent = "列車を読み込んでいます。";
      loadingScreen.setMessage("列車と時刻表を読み込んでいます。");
      const trainLoadStartedAt = performance.now();
      const trainIndex = await loadTrainIndex();
      const stationLineCatalog =
        trainIndex.station_line_catalog ?? emptyStationLineCatalog();
      if (!trainIndex.station_line_catalog) {
        console.warn(
          "[TransitForge] train_indexに駅・路線カタログがないため、路線色をグレーで表示します。",
        );
      }
      const geometry = new PathGeometryIndex(catalog.paths);
      const lineColorIndex = new TrainLineColorIndex(stationLineCatalog);
      const colorsByServiceUid = new Map(
        trainIndex.trains.map((train) => [
          train.service_uid,
          lineColorIndex.colorFor(train).color,
        ]),
      );
      const destinationCoordinatesByServiceUid = new Map(
        trainIndex.trains.flatMap((train) => {
          const coordinate = destinationCoordinateForTrain(train, geometry);
          return coordinate ? [[train.service_uid, coordinate] as const] : [];
        }),
      );
      const lineColorsByPathId = dominantLineColorsByPathId(
        trainIndex.trains,
        colorsByServiceUid,
      );
      const routeCollections = toRouteFeatureCollections(
        catalog,
        64,
        lineColorsByPathId,
      );
      metrics.recordTrainLoad(performance.now() - trainLoadStartedAt);
      logMetrics();
      console.debug("[TransitForge] viewer catalog", {
        routes: catalog.paths.length,
        trains: trainIndex.trains.length,
      });
      for (const [index, routes] of routeCollections.entries()) {
        const sourceId = `routes-${index}`;
        map.addSource(sourceId, { type: "geojson", data: routes });
        map.addLayer({
          id: sourceId,
          type: "line",
          source: sourceId,
          slot: "middle",
          paint: {
            "line-color": [
              "coalesce",
              ["get", "line_color"],
              "#8f9aa6",
            ],
            "line-width": 1.5,
            "line-opacity": 0.48,
          },
        });

        status.textContent = `全経路を読み込んでいます (${index + 1}/${routeCollections.length})。`;
        loadingScreen.setMessage(
          `鉄道路線を描画しています (${index + 1}/${routeCollections.length})。`,
        );
        await nextFrame();
      }

      const maximumRouteTime = maximumRouteTimeFor(trainIndex.trains);
      displayTime.max = String(Math.ceil(maximumRouteTime / 60) * 60);
      const formationLinks = trainFormationLinks(trainIndex.trains);

        loadingScreen.setMessage("列車の初期位置を準備しています。");
        const threeTrainLayer = new MapboxThreeTrainLayer(
          colorsByServiceUid,
          destinationCoordinatesByServiceUid,
          formationLinks,
        );
        applyWeatherToTrains = (mode) => {
          threeTrainLayer.setCloudyAtmosphereEnabled(mode !== "clear");
        };
        applyWeatherToTrains(activeWeatherMode);
        map.addLayer(threeTrainLayer);
        const destinationArcs = configureDestinationArcs(
          threeTrainLayer,
          destinationArcsToggle,
        );
        const congestionUpdates = configureTrainCongestionUpdates(
          threeTrainLayer,
          congestionToggle,
          realtimeUpdateDependencies,
        );
        map.addSource("train-hit-targets", { type: "geojson", data: emptyFeatureCollection() });
        map.addLayer({
          id: "train-hit-targets",
          type: "circle",
          source: "train-hit-targets",
          slot: "top",
          paint: {
            // タッチ操作でも選びやすい44px相当の当たり判定にする。
            "circle-radius": 22,
            "circle-opacity": 0,
            "circle-stroke-opacity": 0,
          },
        });
        const selection = configureTrainSelection(
          map,
          trainIndex.trains,
          threeTrainLayer,
          colorsByServiceUid,
          formationLinks,
          {
            details: trainDetails,
            close: closeTrainDetails,
            title: selectedTrainTitle,
            stopping: selectedTrainStopping,
            delay: selectedTrainDelay,
            stops: selectedTrainStops,
            coupledTabs: trainDetailTabs,
          },
        );
        let displayedPositions: TrainPosition[] = [];
        let latestDelaySnapshot: TrainDelaySnapshot | undefined;
        let digitalTwinModeRequested = true;
        let playbackControls: PlaybackUiController | undefined;
        let aliasedOperationsSource: ReadonlyMap<string, TrainOperation> | undefined;
        let aliasedOperations: ReadonlyMap<string, TrainOperation> | undefined;
        let appliedOperations:
          | ReadonlyMap<string, TrainOperation>
          | undefined
          | null = null;
        let displayTrains = trainIndex.trains;
        let displayDelays: ReadonlyMap<string, number> = new Map();
        let displayDestinationChanges: ReadonlySet<string> = new Set();
        let displayLongTimeStoppingServiceUids: ReadonlySet<string> = new Set();

        const applyOperationMode = (displayedAt: Date) => {
          const now = new Date();
          const realtimeOperations = operationsForDisplay(
            latestDelaySnapshot,
            displayedAt,
            now,
            false,
          );
          const modeState = resolveViewerDisplayMode(
            realtimeOperations !== undefined,
            digitalTwinModeRequested,
          );
          const sourceOperations = modeState.mode === "digital-twin"
            ? realtimeOperations
            : undefined;
          if (sourceOperations !== aliasedOperationsSource) {
            aliasedOperationsSource = sourceOperations;
            const trainNumberOperations = operationsWithTimetableTrainNumberAliases(
              trainIndex.trains,
              sourceOperations,
            );
            aliasedOperations = operationsWithCoupledTrainOperations(
              trainIndex.trains,
              trainNumberOperations,
              formationLinks,
            );
          }
          const operations = aliasedOperations;
          renderDisplayMode(
            {
              app,
              dateTimeInput,
              currentTimeButton,
              toggle: digitalTwinModeToggle,
            },
            realtimeOperations !== undefined,
            modeState.mode,
          );
          congestionUpdates.setAvailable(modeState.congestionEnabled);
          playbackControls?.setDigitalTwinMode(
            !modeState.simulationControlsEnabled,
          );
          if (operations === appliedOperations) {
            return;
          }
          appliedOperations = operations;
          const destinationChanges = destinationChangedServiceUids(
            trainIndex.trains,
            operations,
          );
          displayDestinationChanges = destinationChanges;
          displayTrains = trainsForOperations(
            trainIndex.trains,
            operations,
            destinationChanges,
          );
          displayDelays = delayByTrainNumber(operations);
          displayLongTimeStoppingServiceUids = new Set(
            displayTrains.flatMap((train) =>
              operations?.get(train.train_no)?.longTimeStopping === true
                ? [train.service_uid]
                : [],
            ),
          );
          const operationDestinationCoordinates = new Map(
            displayTrains.flatMap((train) => {
              const coordinate = destinationCoordinateForTrain(train, geometry);
              return coordinate
                ? [[train.service_uid, coordinate] as const]
                : [];
            }),
          );
          threeTrainLayer.setDelayByTrainNumber(displayDelays);
          threeTrainLayer.setDestinationChanges(
            destinationChanges,
            operationDestinationCoordinates,
          );
          selection.updateOperations(operations, destinationChanges);
          console.info("[TransitForge] 列車表示モード", {
            mode: operations ? "digital-twin" : "simulation",
            timetableTrains: trainIndex.trains.length,
            displayedTrains: displayTrains.length,
            unobservedTimetableEntries: operations
              ? trainIndex.trains.length - displayTrains.length
              : 0,
            delayedTrains: [...displayDelays.values()].filter(
              (delay) => delay > 0,
            ).length,
            destinationChangedTrains: destinationChanges.size,
            longTimeStoppingTrains: displayLongTimeStoppingServiceUids.size,
            collectedAt: latestDelaySnapshot?.collectedAt,
          });
        };

        const updateTrains = (routeTime = Number(displayTime.value)) => {
          const lightPreset = lightPresetForRouteTime(routeTime);
          if (lightPreset !== activeLightPreset) {
            map.setConfigProperty("basemap", "lightPreset", lightPreset);
            app.dataset.uiColorMode = uiColorModeForLightPreset(lightPreset);
            activeLightPreset = lightPreset;
          }
          const updateStartedAt = performance.now();
          const displayedAt = dateForOperatingRouteTime(
            displayedServiceDateStart,
            routeTime,
          );
          applyOperationMode(displayedAt);
          const calculatedPositions = activeTrainPositions(
            displayTrains,
            geometry,
            routeTime,
            displayDelays,
            displayDestinationChanges,
          );
          const positions = freezeLongTimeStoppingPositions(
            calculatedPositions,
            displayedPositions,
            displayLongTimeStoppingServiceUids,
            displayDestinationChanges,
          );
          displayedPositions = positions;
          threeTrainLayer.setPositions(positions);
          selection.updateTracking(positions);
          const hitSource = map.getSource("train-hit-targets") as mapboxgl.GeoJSONSource;
          const trainLayouts = coupledTrainLayouts(positions, formationLinks);
          hitSource.setData({
            type: "FeatureCollection",
            features: trainHitTargetsFor(trainLayouts).map((target) => ({
              type: "Feature" as const,
              properties: { service_uid: target.serviceUid },
              geometry: { type: "Point" as const, coordinates: target.coordinate },
            })),
          });
          renderDisplayDateTime(dateTimeDisplayElements, displayedAt);
          status.hidden = true;
          metrics.recordPositionUpdate(performance.now() - updateStartedAt, positions.length);
          logMetrics();
        };

        const resolveDirectRouteOrigin = async (request: Parameters<DirectRouteSearchHandler>[0]) => {
          // Bedrockなど外部境界からの値は、駅名未指定のプレースホルダーを信用しない。
          let originStation = isUsableOriginStation(request.originStation)
            ? request.originStation.trim()
            : undefined;
          let distanceMeters: number | undefined;
          if (!originStation) {
            const coordinate = await currentBrowserCoordinate();
            const nearest = nearestOriginWithDepartures(
              trainIndex.trains,
              stationLineCatalog,
              request.departureTimeMinutes,
              coordinate,
            );
            if (!nearest) {
              throw new Error(
                "現在地の近くに出発可能な駅が見つかりません。出発駅を入力してください。",
              );
            }
            originStation = nearest.stationName;
            distanceMeters = nearest.distanceMeters;
          }
          return { originStation, distanceMeters };
        };
        const localSearchRoutes: DirectRouteSearchHandler = async (request) => {
          const { originStation, distanceMeters } = await resolveDirectRouteOrigin(request);
          const excludedServiceTypes = new Set(
            request.excludedServiceTypes ?? [],
          );
          const excludedTrainNames = new Set(request.excludedTrainNames ?? []);
          const excludedTrainNumbers = new Set(
            request.excludedTrainNumbers ?? [],
          );
          const excludedServiceUids = new Set(
            request.excludedServiceUids ?? [],
          );
          const requiredServiceTypes = new Set(
            request.requiredServiceTypes ?? [],
          );
          const requiredTrainNames = new Set(request.requiredTrainNames ?? []);
          const requiredTrainNumbers = new Set(
            request.requiredTrainNumbers ?? [],
          );
          const allowedServiceTypes = new Set(
            request.allowedServiceTypes ?? [],
          );
          const normalizeExclusion = (value: string) =>
            value.normalize("NFKC").replace(/\s+/gu, "");
          const locallyExcluded = (train: Train) => {
            const trainName = normalizeExclusion(train.train_name);
            const trainFamily = trainName.replace(/[0-9]+号$/u, "");
            const excludedByName = [...excludedTrainNames].some((value) => {
              const excludedName = normalizeExclusion(value);
              return /[0-9]+号$/u.test(excludedName)
                ? trainName === excludedName
                : trainFamily === excludedName;
            });
            return excludedServiceTypes.has(train.service_type) ||
              excludedByName ||
              excludedTrainNumbers.has(train.train_no) ||
              excludedServiceUids.has(train.service_uid);
          };
          const locallyRequired = (train: Train) => {
            const trainName = normalizeExclusion(train.train_name);
            const trainFamily = trainName.replace(/[0-9]+号$/u, "");
            const hasRequiredName = [...requiredTrainNames].every((value) => {
              const requiredName = normalizeExclusion(value);
              return /[0-9]+号$/u.test(requiredName)
                ? trainName === requiredName
                : trainFamily === requiredName;
            });
            return [...requiredServiceTypes].every(
              (value) => train.service_type === value,
            ) && hasRequiredName && [...requiredTrainNumbers].every(
              (value) => train.train_no === value,
            );
          };
          return {
            originStation,
            ...(excludedServiceTypes.size > 0
              ? { excludedServiceTypes: [...excludedServiceTypes] }
              : {}),
            ...(excludedTrainNames.size > 0
              ? { excludedTrainNames: [...excludedTrainNames] }
              : {}),
            ...(excludedTrainNumbers.size > 0
              ? { excludedTrainNumbers: [...excludedTrainNumbers] }
              : {}),
            ...(excludedServiceUids.size > 0
              ? { excludedServiceUids: [...excludedServiceUids] }
              : {}),
            ...(requiredServiceTypes.size > 0
              ? { requiredServiceTypes: [...requiredServiceTypes] }
              : {}),
            ...(requiredTrainNames.size > 0
              ? { requiredTrainNames: [...requiredTrainNames] }
              : {}),
            ...(requiredTrainNumbers.size > 0
              ? { requiredTrainNumbers: [...requiredTrainNumbers] }
              : {}),
            ...(allowedServiceTypes.size > 0
              ? { allowedServiceTypes: [...allowedServiceTypes] }
              : {}),
            ...(distanceMeters === undefined ? {} : { distanceMeters }),
            results: searchDirectRoutes(
              displayTrains.filter((train) =>
                !locallyExcluded(train) &&
                locallyRequired(train) &&
                (allowedServiceTypes.size === 0 ||
                  allowedServiceTypes.has(train.service_type))
              ),
              originStation,
              request.destinationStation,
              request.departureTimeMinutes,
            ),
          };
        };
        const backendSearchRoutes: DirectRouteSearchHandler = async (request) => {
          const { originStation, distanceMeters } = await resolveDirectRouteOrigin(request);
          const response = await journeySearchService.search({
            serviceDate:
              request.serviceDate ?? formatServiceDate(displayedServiceDateStart),
            originStation,
            destinationStation: request.destinationStation,
            departureTimeMinutes: request.departureTimeMinutes,
            limit: 3,
            maxTransfers: request.maxTransfers ?? 3,
            transferPace: request.transferPace,
            rankingPreference: request.rankingPreference,
            excludedServiceTypes: request.excludedServiceTypes,
            excludedTrainNames: request.excludedTrainNames,
            excludedTrainNumbers: request.excludedTrainNumbers,
            excludedServiceUids: request.excludedServiceUids,
            requiredServiceTypes: request.requiredServiceTypes,
            requiredTrainNames: request.requiredTrainNames,
            requiredTrainNumbers: request.requiredTrainNumbers,
            allowedServiceTypes: request.allowedServiceTypes,
          });
          const trainsByServiceUid = new Map(
            displayTrains.map((train) => [train.service_uid, train]),
          );
          return {
            originStation: response.originStation,
            serviceDate: response.serviceDate,
            ...(request.departureDate === undefined
              ? {}
              : { departureDate: request.departureDate }),
            transferPace: response.transferPace ?? request.transferPace,
            rankingPreference:
              response.rankingPreference ?? request.rankingPreference,
            maxTransfers: response.maxTransfers ?? request.maxTransfers,
            excludedServiceTypes:
              response.excludedServiceTypes ?? request.excludedServiceTypes,
            excludedTrainNames:
              response.excludedTrainNames ?? request.excludedTrainNames,
            excludedTrainNumbers:
              response.excludedTrainNumbers ?? request.excludedTrainNumbers,
            excludedServiceUids:
              response.excludedServiceUids ?? request.excludedServiceUids,
            requiredServiceTypes:
              response.requiredServiceTypes ?? request.requiredServiceTypes,
            requiredTrainNames:
              response.requiredTrainNames ?? request.requiredTrainNames,
            requiredTrainNumbers:
              response.requiredTrainNumbers ?? request.requiredTrainNumbers,
            allowedServiceTypes:
              response.allowedServiceTypes ?? request.allowedServiceTypes,
            ...(distanceMeters === undefined ? {} : { distanceMeters }),
            journeys: response.journeys.map((journey) => ({
              departureTimeMinutes: journey.departureTimeMinutes,
              arrivalTimeMinutes: journey.arrivalTimeMinutes,
              transferCount: journey.transferCount,
              legs: journey.legs.map((leg) => {
                const line = lineColorIndex.colorForStations(
                  leg.serviceType,
                  leg.destinationStation,
                  leg.stops?.map((stop) => stop.stationName) ?? [
                    leg.originStation,
                    leg.destinationStation,
                  ],
                );
                return {
                  serviceUid: leg.serviceUid,
                  trainNumber: leg.trainNumber,
                  serviceType: leg.serviceType,
                  trainName: leg.trainName,
                  serviceDestination: leg.serviceDestination,
                  originStation: leg.originStation,
                  destinationStation: leg.destinationStation,
                  departureTimeMinutes: leg.departureTimeMinutes,
                  arrivalTimeMinutes: leg.arrivalTimeMinutes,
                  scheduledDepartureTimeMinutes: leg.scheduledDepartureTimeMinutes,
                  scheduledArrivalTimeMinutes: leg.scheduledArrivalTimeMinutes,
                  delayMinutes: leg.delayMinutes,
                  delayStatus: leg.delayStatus,
                  delaySampleCount: leg.delaySampleCount,
                  delayBasis: leg.delayBasis,
                  lineName: line.lineName,
                  lineColor: line.color,
                  stops: leg.stops,
                };
              }),
            })),
            results: response.matches.flatMap((match) => {
              const train = trainsByServiceUid.get(match.serviceUid);
              return train ? [{
                train,
                originStation: match.originStation,
                destinationStation: match.destinationStation,
                departureTimeMinutes: match.departureTimeMinutes,
                arrivalTimeMinutes: match.arrivalTimeMinutes,
              }] : [];
            }),
          };
        };
        const routeLeg = (leg: JourneyRouteLeg): JourneyRouteLeg => {
          const line = lineColorIndex.colorForStations(
            leg.serviceType,
            leg.destinationStation,
            leg.stops?.map((stop) => stop.stationName) ?? [
              leg.originStation,
              leg.destinationStation,
            ],
          );
          return { ...leg, lineName: line.lineName, lineColor: line.color };
        };
        findJourneyLegAlternatives = async ({
          plan,
          journey,
          startLegIndex,
          endLegIndex,
          requiredServiceTypes,
        }) => {
          const startLeg = journey.legs[startLegIndex];
          const endLeg = journey.legs[endLegIndex];
          if (!startLeg || !endLeg) {
            return [];
          }
          const response = await journeySearchService.search({
            serviceDate: plan.serviceDate ?? formatServiceDate(displayedServiceDateStart),
            originStation: startLeg.originStation,
            destinationStation: endLeg.destinationStation,
            departureTimeMinutes: startLeg.departureTimeMinutes,
            limit: 5,
            maxTransfers: 0,
            transferPace: plan.transferPace,
            rankingPreference: "earliest-arrival",
            ...(requiredServiceTypes.length
              ? { requiredServiceTypes }
              : {}),
          });
          return response.journeys
            .filter((candidate) => candidate.legs.length === 1)
            .map((candidate) => routeLeg(candidate.legs[0]))
            .filter((candidate) =>
              candidate.serviceUid !== startLeg.serviceUid &&
              journeyLegAlternativeFits(
                journey,
                startLegIndex,
                candidate,
                plan.transferPace,
                endLegIndex,
              ));
        };
        const disposeDelayUpdates = configureTrainDelayUpdates((snapshot) => {
          latestDelaySnapshot = snapshot;
          updateTrains();
        }, realtimeUpdateDependencies);
        disposeDataUpdates = () => {
          congestionUpdates.dispose();
          disposeDelayUpdates();
        };

        displayTime.addEventListener("input", () => updateTrains());
        digitalTwinModeToggle.addEventListener("click", () => {
          if (digitalTwinModeToggle.disabled) {
            return;
          }
          digitalTwinModeRequested = digitalTwinModeToggle.ariaPressed !== "true";
          updateTrains();
        });
        configureDateTimeInput(
          dateTimeInput,
          () =>
            dateForOperatingRouteTime(
              displayedServiceDateStart,
              Number(displayTime.value),
            ),
          (date) => {
            displayedServiceDateStart = operatingServiceDateStart(date);
            displayTime.value = String(currentRouteTime(date));
            displayTime.dispatchEvent(new Event("input", { bubbles: true }));
          },
        );
        const setLayerVisibility = (
          layer: ViewerAgentLayer,
          visible: boolean,
        ) => {
          if (layer === "congestion") {
            congestionUpdates.setEnabled(visible);
          } else {
            destinationArcs.setEnabled(visible);
          }
        };
        const viewerControlExecutionId = "viewer-control-session";
        const viewerControlScope = new ViewerActionTaskScope(viewerControlExecutionId);
        const viewerControlTrace = new AgentTraceRecorder(viewerControlExecutionId);
        const viewerActionExecutor = new ViewerActionExecutor({
          setDisplayTime: (routeTimeMinutes) => {
            displayTime.value = String(routeTimeMinutes);
            displayTime.dispatchEvent(new Event("input", { bubbles: true }));
          },
          focusTrain: selection.focusTrain,
          highlightRoute: () => false,
          compareJourneys: () => false,
          showEvidence: () => false,
          setWeather: selectWeather,
          setLayerVisibility,
        }, maximumRouteTime);
        const setViewerDisplayTime = (routeTimeMinutes: number) => {
          const execution = viewerActionExecutor.execute(
            { type: "set_display_time", routeTimeMinutes },
            viewerControlScope,
            viewerControlTrace,
          );
          if (!execution.ok) throw new Error(execution.reason);
        };
        let previousJourneyPlan: ViewerAgentJourneyPlan | undefined;
        let pendingJourneyLegChange: PendingJourneyLegChange | undefined;
        let pendingJourneyGuidance: JourneyNavigationGuidance | undefined;
        const localAiGuidePromptHandler = createLocalViewerAgent({
          trains: trainIndex.trains,
          getTrains: () => displayTrains,
          getPositions: () => displayedPositions,
          getRouteTime: () => Number(displayTime.value),
          setRouteTime: setViewerDisplayTime,
          focusTrain: selection.focusTrain,
          setWeather: selectWeather,
          setLayerVisibility,
          searchDirectRoutes: localSearchRoutes,
          getPendingJourneyGuidance: () => pendingJourneyGuidance,
          formatTrainTitle: (train) => {
            const title = trainTitleFor(train);
            return `${title.main}${title.suffix ?? ""}`;
          },
          maximumRouteTime,
        });
        handleAiGuidePrompt = async (
          prompt,
          preferences,
          _conversation,
          onResponseMetadata,
        ) => {
          try {
            const requestedGuidance = journeyNavigationGuidanceFromPrompt(
              prompt,
              trainIndex.trains,
            );
            const routeRequest = directRouteRequestFromPrompt(
              prompt,
              trainIndex.trains,
            );
            const unsupportedExperience =
              unsupportedJourneyExperienceFromPrompt(prompt);
            if (unsupportedExperience) {
              return unsupportedJourneyExperienceResponse(
                unsupportedExperience,
              );
            }
            if (requestedGuidance && !routeRequest && !previousJourneyPlan) {
              pendingJourneyGuidance = mergeJourneyNavigationGuidance(
                pendingJourneyGuidance,
                requestedGuidance,
              );
              return journeyNavigationGuidanceResponse(
                pendingJourneyGuidance,
              );
            }
            const followUp = journeyChatFollowUpIntent(
              prompt,
              previousJourneyPlan,
              pendingJourneyLegChange,
            );
            if (followUp?.type === "intermediate-stops" && previousJourneyPlan) {
              return intermediateStopsResponse(
                previousJourneyPlan,
                followUp.journeyIndex,
                followUp.legIndex,
              );
            }
            if (followUp?.type === "alternative" && previousJourneyPlan) {
              const journey = previousJourneyPlan.journeys[followUp.journeyIndex];
              const leg = journey?.legs[followUp.legIndex];
              const endLeg = journey?.legs[followUp.endLegIndex];
              if (journey && leg && endLeg) {
                let alternatives = await findJourneyLegAlternatives({
                  plan: previousJourneyPlan,
                  journey,
                  startLegIndex: followUp.legIndex,
                  endLegIndex: followUp.endLegIndex,
                  requiredServiceTypes: followUp.requiredServiceTypes,
                });
                if (followUp.preferLaterDeparture) {
                  alternatives = alternatives.filter(
                    (candidate) =>
                      candidate.departureTimeMinutes > leg.departureTimeMinutes,
                  );
                }
                alternatives = alternatives.slice(0, 3);
                pendingJourneyLegChange = alternatives.length > 0
                  ? {
                      plan: previousJourneyPlan,
                      journeyIndex: followUp.journeyIndex,
                      legIndex: followUp.legIndex,
                      endLegIndex: followUp.endLegIndex,
                      alternatives,
                    }
                  : undefined;
                return alternativeProposalResponse(
                  { ...leg, destinationStation: endLeg.destinationStation },
                  alternatives,
                );
              }
            }
            if (
              followUp?.type === "confirm-alternative" &&
              pendingJourneyLegChange
            ) {
              const pending = pendingJourneyLegChange;
              previousJourneyPlan = applyJourneyLegAlternative(
                pending,
                followUp.alternativeIndex,
              );
              pendingJourneyLegChange = undefined;
              return {
                text: appliedAlternativeResponse(
                  pending,
                  followUp.alternativeIndex,
                ),
                journeyPlan: previousJourneyPlan,
              };
            }
            const response = await runBedrockViewerAgent(
              prompt,
              {
                trains: trainIndex.trains,
                getTrains: () => displayTrains,
                getPositions: () => displayedPositions,
                getRouteTime: () => Number(displayTime.value),
                setRouteTime: setViewerDisplayTime,
                focusTrain: selection.focusTrain,
                setWeather: selectWeather,
                setLayerVisibility,
                queryDailyCongestionAnalysis: async (serviceDate) =>
                  congestionAnalysisForAgent(
                    await queryDailyCongestionAnalysis(serviceDate),
                    trainIndex.trains,
                    (train) => lineColorIndex.colorFor(train).lineName,
                  ),
                queryTrainDelayAnalysis: async (serviceDate) =>
                  delayAnalysisForAgent(
                    await queryTrainDelayAnalysis(serviceDate),
                    trainIndex.trains,
                  ),
                searchRepresentativeTimetable,
                searchDirectRoutes: backendSearchRoutes,
                searchAccommodations,
                getJourneySearchPreferences: () => preferences,
                getPreviousJourneyPlan: () => previousJourneyPlan,
                getPendingJourneyGuidance: () => pendingJourneyGuidance,
                conciergeInstruction: currentConciergeInstruction(prompt),
                rememberTravelPreference: (statement, confidence) =>
                  rememberTravelPreference(
                    localStorage,
                    statement,
                    activeConversationSession.id,
                    confidence,
                  ),
                updateConversationSession: (update) => {
                  Object.assign(activeConversationSession, update, {
                    updatedAt: new Date().toISOString(),
                  });
                  conversationSessionRepository.save(activeConversationSession);
                },
                getTripPlan: () => loadTripPlan(
                  localStorage,
                  activeConversationSession.id,
                ),
                getUserProfile: () => loadUserProfile(localStorage),
                maximumRouteTime,
              },
              async (messages) => {
                const result = await invokeBedrockAgent(messages);
                onResponseMetadata?.(result.metadata);
                return result.body;
              },
            );
            if (typeof response !== "string" && "journeyPlan" in response) {
              previousJourneyPlan = response.journeyPlan;
              pendingJourneyLegChange = undefined;
              pendingJourneyGuidance = undefined;
            }
            return response;
          } catch (error) {
            if (import.meta.env.DEV) {
              const localResponse = await localAiGuidePromptHandler(prompt);
              if (directRouteRequestFromPrompt(prompt, trainIndex.trains)) {
                pendingJourneyGuidance = undefined;
              }
              return localResponse;
            }
            throw error;
          }
        };
        displayTime.disabled = false;
        currentTimeButton.disabled = false;
        const playbackSpeedControls = configurePlaybackSpeed(
          playbackSpeed,
          playbackSpeedButtons,
          playbackSpeedMenuToggle,
          playbackSpeedOptions,
        );
        playbackControls = configurePlayback(
          { displayTime, playToggle, currentTimeButton, playbackSpeed },
          updateTrains,
          maximumRouteTime,
          (date) => {
            displayedServiceDateStart = operatingServiceDateStart(date);
          },
          () => {
            displayedServiceDateStart = stepDisplayDateTime(
              displayedServiceDateStart,
              "day",
              1,
            );
          },
          playbackSpeedControls,
          browserDigitalTwinClockEnvironment(),
        );
        updateTrains();
        await nextFrame();
        loadingScreen.complete();
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラーです。";
      status.hidden = false;
      status.textContent = `入力を読み込めませんでした: ${message}`;
      loadingScreen.fail(`入力を読み込めませんでした: ${message}`);
    }
  });

  map.on("error", (event) => {
    status.hidden = false;
    status.textContent = `地図の読み込みに失敗しました: ${event.error.message}`;
    if (!loadingScreen.isComplete()) {
      loadingScreen.fail(
        `地図の読み込みに失敗しました: ${event.error.message}`,
      );
    }
  });
}

function currentBrowserCoordinate(): Promise<StationCoordinate> {
  if (!("geolocation" in navigator)) {
    return Promise.reject(
      new Error("この端末では現在地を取得できません。出発駅を入力してください。"),
    );
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve([
        position.coords.longitude,
        position.coords.latitude,
      ]),
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "現在地の利用が許可されていません。出発駅を入力するか、位置情報を許可してください。"
          : "現在地を取得できませんでした。出発駅を入力してください。";
        reject(new Error(message));
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 5 * 60_000,
      },
    );
  });
}

function formatServiceDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

function monitorFrames(): void {
  let previousTimestamp: number | undefined;
  let nextRenderTimestamp = 0;

  const record = (timestamp: number) => {
    if (previousTimestamp !== undefined) {
      metrics.recordFrame(timestamp - previousTimestamp);
      if (timestamp >= nextRenderTimestamp) {
        logMetrics();
        nextRenderTimestamp = timestamp + 500;
      }
    }
    previousTimestamp = timestamp;
    requestAnimationFrame(record);
  };

  requestAnimationFrame(record);
}

function logMetrics(): void {
  const now = performance.now();
  if (now < nextMetricsLogTimestamp) {
    return;
  }
  nextMetricsLogTimestamp = now + metricsLogIntervalMilliseconds;
  const snapshot = metrics.getSnapshot();
  console.debug("[TransitForge] runtime metrics", {
    ...snapshot,
    usedJsHeap: formatHeapUsage(),
  });
}

function formatHeapUsage(): string {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? `${(memory.usedJSHeapSize / 1_048_576).toFixed(0)} MiB` : "未対応";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
