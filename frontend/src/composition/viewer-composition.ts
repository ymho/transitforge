import mapboxgl from "mapbox-gl";
import { browserDigitalTwinClockEnvironment } from "../adapters/browser/digital-twin-clock-environment";
import { browserPollingEnvironment } from "../adapters/browser/polling-controller";
import { currentBrowserCoordinate } from "../adapters/browser/current-coordinate";
import { createRuntimeMonitor, nextBrowserFrame } from "../adapters/browser/runtime-monitor";
import { applyWeather } from "../adapters/mapbox/map-weather";
import {
  createVerifiedPlaceLayer,
  type VerifiedPlaceLayerController,
} from "../adapters/mapbox/place-media-layer";
import { BrowserTravelRecheckRepository } from "../adapters/browser/travel-recheck-repository";
import { runDueTravelRechecks } from "../usecases/trip-plan/travel-recheck-runner";
import {
  congestionRefreshIntervalMilliseconds,
  congestionRetryIntervalMilliseconds,
  loadTrainCongestion,
} from "../adapters/http/traffic/train-congestion";
import {
  loadTrainDelays,
  trainDelayRefreshIntervalMilliseconds,
  trainDelayRetryIntervalMilliseconds,
} from "../adapters/http/traffic/train-delay";
import {
  loadPathCatalog,
  toRouteFeatureCollections,
} from "../adapters/http/viewer-input/path-catalog";
import { emptyStationLineCatalog } from "../adapters/http/viewer-input/station-line-catalog";
import {
  invokeBedrockAgent,
  queryDailyCongestionAnalysis,
  queryTrainDelayAnalysis,
  searchAccommodations,
  searchWeatherForecast,
  searchPlaceMedia,
  searchFlights,
  searchRepresentativeTimetable,
  journeySearchService,
  submitConversationFeedback,
  submitAgentTrace,
} from "../adapters/http/agent-api/bedrock-agent";
import { loadTrainIndex } from "../adapters/http/viewer-input/train-index";
import type { TrainDelaySnapshot, TrainOperation } from "@raiquora/operation/operation";
import {
  alternativeProposalResponse,
  appliedAlternativeResponse,
  applyJourneyLegAlternative,
  intermediateStopsResponse,
  journeyChatFollowUpIntent,
  type JourneyLegAlternativeSearch,
  type PendingJourneyLegChange,
} from "../domain/journey-chat-follow-up";
import {
  journeyNavigationGuidanceFromPrompt,
  journeyNavigationGuidanceResponse,
  mergeJourneyNavigationGuidance,
  unsupportedJourneyExperienceFromPrompt,
  unsupportedJourneyExperienceResponse,
  type JourneyNavigationGuidance,
} from "../domain/journey-navigation-intent";
import {
  dateForOperatingRouteTime,
  operatingServiceDateStart,
  stepDisplayDateTime,
} from "../domain/display-date-time";
import {
  lightPresetForRouteTime,
  uiColorModeForLightPreset,
  type LightPreset,
} from "../domain/map-lighting";
import type { WeatherMode } from "../domain/weather";
import { dominantLineColorsByPathId } from "../domain/path-line-colors";
import { currentRouteTime } from "../domain/playback";
import { congestionAnalysisForAgent } from "../domain/congestion-analysis";
import { delayAnalysisForAgent } from "../domain/delay-analysis";
import {
  coupledTrainLayouts,
  trainHitTargetsFor,
} from "../domain/coupled-train-layout";
import { TrainLineColorIndex } from "../domain/train-line-color";
import { trainFormationLinks } from "../domain/train-formation-link";
import {
  delayByTrainNumber,
  destinationChangedServiceUids,
  operationsForDisplay,
  operationsWithCoupledTrainOperations,
  operationsWithTimetableTrainNumberAliases,
  trainsForOperations,
} from "@raiquora/operation/train-operation-state";
import {
  activeTrainPositions,
  destinationCoordinateForTrain,
  freezeLongTimeStoppingPositions,
  PathGeometryIndex,
} from "../domain/train-position";
import type { TrainPosition } from "../domain/train-position";
import {
  type ViewerAgentLayer,
} from "../usecases/viewer/viewer-action";
import { AgentTraceRecorder } from "../usecases/agent/agent-trace";
import { ViewerActionExecutor } from "../usecases/viewer/viewer-action-executor";
import { ViewerActionTaskScope } from "../usecases/viewer/viewer-action-policy";
import { loadViewerElements } from "../usecases/viewer/viewer-elements";
import { resolveViewerDisplayMode } from "../domain/viewer-display-mode";
import { runViewerAgentRuntime } from "../adapters/bedrock/viewer-agent-runtime";
import { createLocalViewerAgent } from "../usecases/agent/local-viewer-agent";
import {
  directRouteRequestFromPrompt,
} from "../usecases/viewer/viewer-local-tools";
import type { ViewerAgentJourneyPlan } from "../domain/viewer-agent-response";
import {
  configureAiGuidePanel,
  type AiGuidePromptHandler,
} from "../presentation/concierge/ai-guide-panel";
import { configureLandmarkJourneyInteraction } from "../presentation/concierge/landmark-journey-interaction";
import { configureTrainSelection } from "../presentation/train-viewer/train-selection-controller";
import { trainTitleFor } from "../presentation/train-viewer/train-title";
import {
  configureTrainCongestionUpdates,
  configureTrainDelayUpdates,
} from "../usecases/train-viewer/realtime-updates";
import {
  configureDateTimeInput,
  maximumRouteTimeFor,
  renderDisplayDateTime,
} from "../presentation/train-viewer/date-time-control";
import {
  configurePlayback,
  configurePlaybackSpeed,
  type PlaybackUiController,
} from "../presentation/train-viewer/playback-controls";
import {
  configureDestinationArcs,
  configureWeather,
  renderDisplayMode,
} from "../presentation/train-viewer/map-controls";
import { createLoadingScreen } from "../presentation/shared/loading-screen";
import {
  configureMapPlaceExplorer,
  type MapPlaceExplorerController,
} from "../presentation/place-explorer/map-place-explorer";
import { MapboxThreeTrainLayer } from "../presentation/train-viewer/rendering/mapbox-three-train-layer";
import { RuntimeMetrics } from "../observability/runtime-metrics";
import { configureTravelProfile } from "../presentation/concierge/travel-profile-panel";
import {
  buildConciergePrompt,
  selectConciergeForUserProfile,
} from "../features/concierge";
import {
  loadUserProfile,
  travelProfileChangedEvent,
} from "../usecases/trip-profile/user-profile-repository";
import { promptWithConversationContext } from "../domain/conversation-guidance";
import { renderConciergeIdentity } from "../presentation/concierge/concierge-identity";
import { configureConversationHistoryPanel } from "../presentation/concierge/conversation-history-panel";
import { configureTripPlanPanel } from "../presentation/trip-plan/trip-plan-panel";
import { tripPlanFromTravelPlan } from "@raiquora/trip/trip-plan";
import { loadTripPlan } from "../usecases/trip-plan/trip-plan-repository";
import {
  conversationContextSummary,
  loadTravelMemories,
  rememberTravelPreference,
} from "../domain/conversation-session";
import {
  browserConversationSessionStorageEvents,
  LocalConversationSessionRepository,
} from "../adapters/browser/conversation-session-repository";
import { LocalConversationHistoryRepository } from "../adapters/browser/conversation-history-repository";
import {
  latestJourneyPlanFromHistory,
  recentConversationContext,
} from "../domain/conversation-history";
import { createConversationSessionSwitcher } from "../usecases/concierge/conversation-session-switcher";
import { createJourneySearchHandlers } from "../usecases/journey/create-journey-search-handlers";
import { BrowserContextWorkspaceRepository } from "../adapters/browser/context-workspace-repository";
import { createContextWorkspaceController } from "../usecases/context-workspace/context-workspace-controller";
import type { ContextViewKind } from "../domain/context-workspace";
import { createMobileContextNavigation } from "../presentation/concierge/mobile-context-navigation";

export function startViewer(): void {

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
  contextWorkspaceTabs,
  contextWorkspaceButtons,
  closeContextWorkspace,
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
  mapPlaceExplorer,
  mapPlaceExplorerList,
  closeMapPlaceExplorer,
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
const runtimeMonitor = createRuntimeMonitor(metrics);

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
const travelRecheckRepository = new BrowserTravelRecheckRepository(localStorage);
let activeConversationSession = conversationSessionRepository.active() ??
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
let verifiedPlaceLayer: VerifiedPlaceLayerController | undefined;
let mapPlaceExplorerController: MapPlaceExplorerController | undefined;
let pendingVerifiedPlaces: import("@raiquora/trip/place-media").PlaceMedia[] = [];
let applyForecastWeather: ((forecast: import("@raiquora/trip/weather-forecast").WeatherForecast) => void) | undefined;
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
const desktopChatShell = window.matchMedia("(min-width: 72rem)");
const mobileChatShell = window.matchMedia("(max-width: 71.999rem)");
const contextWorkspaceController = createContextWorkspaceController(
  activeConversationSession.id,
  new BrowserContextWorkspaceRepository(localStorage),
);
const mobileContextNavigation = createMobileContextNavigation({
  app,
  messages: aiGuideMessages,
  input: aiGuideInput,
  showContext: (view) => contextWorkspaceController.show(view),
  restoreFocus: () => window.matchMedia("(pointer: fine)").matches,
});
const applyContextWorkspaceState = () => {
  const state = contextWorkspaceController.current();
  app.dataset.contextView = state.view;
  const currentTripPlan = loadTripPlan(localStorage, state.conversationSessionId);
  for (const button of contextWorkspaceButtons) {
    const view = button.dataset.contextView as ContextViewKind;
    button.ariaPressed = String(view === state.view);
    if (view === "trip-plan") button.disabled = currentTripPlan === undefined;
    if (view === "journey-details") {
      button.disabled = state.entity?.kind !== "journey";
    }
  }
  if (state.view === "trip-plan" && currentTripPlan) {
    if (!trainDetails.hidden) closeTrainDetails.click();
    tripPlanController.open();
    return;
  }
  if (!tripPlanPanel.hidden) tripPlanPanel.hidden = true;
  if (state.view === "map" && !trainDetails.hidden) closeTrainDetails.click();
};
contextWorkspaceController.subscribe(applyContextWorkspaceState);
for (const button of contextWorkspaceButtons) {
  button.addEventListener("click", () => {
    const view = button.dataset.contextView as ContextViewKind;
    if (mobileChatShell.matches) mobileContextNavigation.open(view);
    else contextWorkspaceController.show(view);
  });
}
closeContextWorkspace.addEventListener("click", () => {
  mobileContextNavigation.close();
});
contextWorkspaceTabs.hidden = false;
closeTripPlan.addEventListener("click", () => {
  if (mobileChatShell.matches) mobileContextNavigation.close();
  else contextWorkspaceController.show("map");
});
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
      const tripPlan = tripPlanFromTravelPlan(
        plan,
        new Date(),
        `trip-${crypto.randomUUID()}`,
      );
      tripPlanController.show(tripPlan);
      Object.assign(activeConversationSession, {
        scope: "trip",
        tripPlanId: tripPlan.id,
        updatedAt: new Date().toISOString(),
      });
      conversationSessionRepository.save(activeConversationSession);
      contextWorkspaceController.show("trip-plan", {
        kind: "trip-plan",
        id: tripPlan.id,
      });
    },
    onPlaces: (places) => {
      pendingVerifiedPlaces = [...places];
      if (places.length === 0) {
        mapPlaceExplorerController?.clear();
        verifiedPlaceLayer?.clear();
        return;
      }
      verifiedPlaceLayer?.show(places);
      mapPlaceExplorerController?.show(places);
      contextWorkspaceController.show("map");
    },
    onWeather: (forecast) => applyForecastWeather?.(forecast),
    persistent: () => true,
    onTripPlanUpdate: (proposal) => {
      tripPlanController.apply(proposal.patches);
      Object.assign(activeConversationSession, {
        scope: "trip",
        summary: proposal.summary,
        updatedAt: new Date().toISOString(),
      });
      conversationSessionRepository.save(activeConversationSession);
      const currentPlan = loadTripPlan(localStorage, activeConversationSession.id);
      if (currentPlan) {
        contextWorkspaceController.show("trip-plan", {
          kind: "trip-plan",
          id: currentPlan.id,
        });
      }
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
const conversationSessionSwitcher = createConversationSessionSwitcher({
  repository: conversationSessionRepository,
  conversation: aiGuideController,
  tripPlan: tripPlanController,
    onActivated: (session) => {
      activeConversationSession = session;
      updateConciergeIdentity();
      contextWorkspaceController.activateSession(session.id);
  },
});
conversationSessionRepository.subscribe(() => {
  const activeSession = conversationSessionRepository.active();
  if (activeSession && activeSession.id !== activeConversationSession.id) {
    conversationSessionSwitcher.activate(activeSession.id);
  }
});
void runDueTravelRechecks(travelRecheckRepository, {
  weather: (location) => searchWeatherForecast({ location }),
  flights: (originAirportCode, destinationAirportCode, departureDate) => searchFlights({ originAirportCode, destinationAirportCode, departureDate }),
  railOperation: async (serviceDate) => ({
    data: await queryTrainDelayAnalysis(serviceDate),
    evidence: [{ id: `rail-operation:${serviceDate}`, kind: "event", provider: "raiquora-operation-snapshot", retrievedAt: new Date().toISOString(), attribution: "Raiquora operation snapshot", confidence: "observed" }],
  }),
}).then((notices) => { for (const notice of notices) aiGuideController.notify(notice); }).catch(() => undefined);
configureConversationHistoryPanel({
  newConversation,
  toggle: conversationHistoryToggle,
  dialog: conversationHistoryDialog,
  close: closeConversationHistory,
  list: conversationHistoryList,
  empty: conversationHistoryEmpty,
  storage: localStorage,
  repository: conversationSessionRepository,
  onSessionSelected: (sessionId) => {
    if (sessionId !== activeConversationSession.id) {
      conversationSessionSwitcher.activate(sessionId);
    }
  },
  persistentMediaQuery: desktopChatShell,
});
aiGuideController.open();
applyContextWorkspaceState();
configureTravelProfile(document, localStorage, () => aiGuideController.open());
if (tripPreviewEnabled) {
  loadingScreen.complete();
  document.querySelector<HTMLDialogElement>("#travel-profile-dialog")?.close();
  void import("../dev/trip-plan-preview").then(({ tripPlanPreview }) =>
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
  verifiedPlaceLayer = createVerifiedPlaceLayer(map, (place) =>
    mapPlaceExplorerController?.select(place.providerPlaceId, false));
  mapPlaceExplorerController = configureMapPlaceExplorer({
    panel: mapPlaceExplorer,
    list: mapPlaceExplorerList,
    close: closeMapPlaceExplorer,
    focusPlace: (providerPlaceId) => verifiedPlaceLayer?.focus(providerPlaceId),
    consult: (place) => aiGuideController.ask(`${place.name}を旅程へ追加したい`),
    clearPlaces: () => {
      pendingVerifiedPlaces = [];
      verifiedPlaceLayer?.clear();
    },
  });
  if (pendingVerifiedPlaces.length > 0) {
    verifiedPlaceLayer.show(pendingVerifiedPlaces);
    mapPlaceExplorerController.show(pendingVerifiedPlaces);
  }

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
    applyForecastWeather = (forecast) => {
      const code = forecast.hourly[0]?.weatherCode ?? forecast.daily[0]?.weatherCode ?? 0;
      selectWeather(code >= 51 ? "rain" : code >= 1 ? "cloudy" : "clear");
    };
    runtimeMonitor.start();
    let activeLightPreset: LightPreset | undefined;

    try {
      status.textContent = "全経路を読み込んでいます。";
      loadingScreen.setMessage("鉄道路線を読み込んでいます。");
      const routeLoadStartedAt = performance.now();
      const catalog = await loadPathCatalog();
      metrics.recordRouteLoad(performance.now() - routeLoadStartedAt);
      runtimeMonitor.log();

      status.textContent = "列車を読み込んでいます。";
      loadingScreen.setMessage("列車と時刻表を読み込んでいます。");
      const trainLoadStartedAt = performance.now();
      const trainIndex = await loadTrainIndex();
      const stationLineCatalog =
        trainIndex.station_line_catalog ?? emptyStationLineCatalog();
      if (!trainIndex.station_line_catalog) {
        console.warn(
          "[Raiquora] train_indexに駅・路線カタログがないため、路線色をグレーで表示します。",
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
      runtimeMonitor.log();
      console.debug("[Raiquora] viewer catalog", {
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
        await nextBrowserFrame();
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
            onFocus: (serviceUid) => {
              const focused = contextWorkspaceController.show("journey-details", {
                kind: "journey",
                id: serviceUid,
              });
              if (focused && mobileChatShell.matches) {
                app.dataset.mobileContextOpen = "true";
                app.dataset.mobileContextView = "journey-details";
              }
            },
            onEndFocus: () => {
              if (mobileChatShell.matches && mobileContextNavigation.isOpen()) {
                mobileContextNavigation.close();
                return;
              }
              if (contextWorkspaceController.current().view === "journey-details") {
                contextWorkspaceController.show("map");
              }
            },
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
          console.info("[Raiquora] 列車表示モード", {
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
          runtimeMonitor.log();
        };

        const {
          localSearchRoutes,
          backendSearchRoutes,
          findJourneyLegAlternatives: searchJourneyLegAlternatives,
        } = createJourneySearchHandlers({
          trains: trainIndex.trains,
          getDisplayTrains: () => displayTrains,
          stationLineCatalog,
          getDisplayedServiceDateStart: () => displayedServiceDateStart,
          currentCoordinate: currentBrowserCoordinate,
          journeySearchService,
          linePresentation: lineColorIndex,
        });
        findJourneyLegAlternatives = searchJourneyLegAlternatives;
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
        let previousJourneySessionId: string | undefined;
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
            if (previousJourneySessionId !== activeConversationSession.id) {
              previousJourneySessionId = activeConversationSession.id;
              previousJourneyPlan = latestJourneyPlanFromHistory(
                conversationHistoryRepository.list(activeConversationSession.id),
              );
              pendingJourneyLegChange = undefined;
              pendingJourneyGuidance = undefined;
            }
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
            const runtimeRequestIds: string[] = [];
            const response = await runViewerAgentRuntime(
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
                searchWeatherForecast,
                searchPlaceMedia,
                searchFlights,
                scheduleTravelRecheck: (request) => travelRecheckRepository.schedule(request),
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
                storeAgentTrace: async (trace) => {
                  await submitAgentTrace({
                    taskId: activeConversationSession.id,
                    requestIds: runtimeRequestIds,
                    trace,
                  });
                },
                maximumRouteTime,
              },
              async (messages, tools) => {
                const result = await invokeBedrockAgent(messages, fetch, tools);
                onResponseMetadata?.(result.metadata);
                if (result.metadata.requestId) {
                  runtimeRequestIds.push(result.metadata.requestId);
                }
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
        await nextBrowserFrame();
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

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

}
