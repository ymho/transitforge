import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./viewer.css";
import {
  loadPathCatalog,
  toRouteFeatureCollections,
} from "./data/path-catalog";
import { emptyStationLineCatalog } from "./data/station-line-catalog";
import {
  congestionRefreshIntervalMilliseconds,
  congestionRetryIntervalMilliseconds,
  loadTrainCongestion,
} from "./data/train-congestion";
import {
  loadTrainDelays,
  trainDelayRefreshIntervalMilliseconds,
  trainDelayRetryIntervalMilliseconds,
  type TrainDelaySnapshot,
  type TrainOperation,
} from "./data/train-delay";
import {
  browserPollingEnvironment,
  createPollingController,
} from "./data/polling-controller";
import {
  invokeBedrockAgent,
  queryDailyCongestionAnalysis,
  queryTrainDelayAnalysis,
  searchAccommodations,
  searchRepresentativeTimetable,
  searchTravelCandidates,
} from "./data/bedrock-agent";
import { loadTrainIndex, type Train } from "./data/train-index";
import type { StationCoordinate } from "./data/station-line-catalog";
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
  displayDateTimeLabels,
  operatingServiceDateStart,
  stepDisplayDateTime,
} from "./domain/display-date-time";
import {
  lightPresetForRouteTime,
  uiColorModeForLightPreset,
  type LightPreset,
} from "./domain/map-lighting";
import {
  applyWeather,
  isWeatherMode,
  type WeatherMode,
} from "./domain/map-weather";
import { dominantLineColorsByPathId } from "./domain/path-line-colors";
import { currentRouteTime } from "./domain/playback";
import {
  browserDigitalTwinClockEnvironment,
  createDigitalTwinClockSynchronizer,
} from "./domain/digital-twin-clock";
import { PlaybackController } from "./domain/playback-controller";
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
  parseViewerAgentActions,
  type ViewerAgentLayer,
} from "./domain/viewer-agent-action";
import { resolveViewerDisplayMode } from "./domain/viewer-display-mode";
import { runBedrockViewerAgent } from "./domain/viewer-agent-bedrock";
import { createLocalViewerAgent } from "./domain/viewer-agent-local";
import {
  directRouteRequestFromPrompt,
  isUsableOriginStation,
} from "./domain/viewer-agent-local-tools";
import type { ViewerAgentJourneyPlan } from "./domain/viewer-agent-response";
import {
  configureAiGuidePanel,
  type AiGuidePromptHandler,
} from "./presentation/ai-guide-panel";
import { configureLandmarkJourneyInteraction } from "./presentation/landmark-journey-interaction";
import { configureTrainSelection } from "./presentation/train-selection-controller";
import { createLoadingScreen } from "./presentation/loading-screen";
import { MapboxThreeTrainLayer } from "./rendering/mapbox-three-train-layer";
import { RuntimeMetrics } from "./observability/runtime-metrics";
import { configureTravelProfile } from "./presentation/travel-profile-panel";
import {
  buildConciergePrompt,
  selectConciergeForUserProfile,
} from "./features/concierge";
import { loadUserProfile, travelProfileChangedEvent } from "./domain/travel-profile";
import { renderConciergeIdentity } from "./presentation/concierge-identity";

const minimumPlaybackRenderIntervalMilliseconds = 1_000 / 30;
const metricsLogIntervalMilliseconds = 10_000;
let nextMetricsLogTimestamp = 0;

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const app = document.querySelector<HTMLElement>("#app");
const loadingScreenElement =
  document.querySelector<HTMLElement>("#loading-screen");
const loadingScreenMessage =
  document.querySelector<HTMLElement>("#loading-screen-message");
const loadingScreenRetry =
  document.querySelector<HTMLButtonElement>("#loading-screen-retry");
const status = document.querySelector<HTMLParagraphElement>("#map-status");
const displayTime = document.querySelector<HTMLInputElement>("#display-time");
const dateTimeInput =
  document.querySelector<HTMLInputElement>("#date-time-input");
const dateTimeDate = document.querySelector<HTMLElement>("#date-time-date");
const dateTimeClock = document.querySelector<HTMLTimeElement>("#date-time-clock");
const playToggle = document.querySelector<HTMLButtonElement>("#play-toggle");
const currentTimeButton =
  document.querySelector<HTMLButtonElement>("#current-time-button");
const playbackSpeed = document.querySelector<HTMLInputElement>("#playback-speed");
const playbackSpeedMenuToggle =
  document.querySelector<HTMLButtonElement>("#playback-speed-menu-toggle");
const playbackSpeedOptions =
  document.querySelector<HTMLFieldSetElement>("#playback-speed-options");
const playbackSpeedButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-playback-speed]"),
);
const mapTools = document.querySelector<HTMLElement>("#map-tools");
const weatherButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-weather]"),
);
const weatherMenuToggle =
  document.querySelector<HTMLButtonElement>("#weather-menu-toggle");
const weatherOptions =
  document.querySelector<HTMLFieldSetElement>("#weather-options");
const congestionToggle =
  document.querySelector<HTMLButtonElement>("#congestion-toggle");
const destinationArcsToggle =
  document.querySelector<HTMLButtonElement>("#destination-arcs-toggle");
const digitalTwinModeToggle =
  document.querySelector<HTMLButtonElement>("#digital-twin-mode-toggle");
const aiGuidePanel = document.querySelector<HTMLElement>("#ai-guide-panel");
const aiGuideToggle =
  document.querySelector<HTMLButtonElement>("#ai-guide-toggle");
const closeAiGuide =
  document.querySelector<HTMLButtonElement>("#close-ai-guide");
const aiGuideMessages =
  document.querySelector<HTMLOListElement>("#ai-guide-messages");
const aiGuideForm = document.querySelector<HTMLFormElement>("#ai-guide-form");
const aiGuideInput =
  document.querySelector<HTMLInputElement>("#ai-guide-input");
const aiGuideSubmit =
  document.querySelector<HTMLButtonElement>("#ai-guide-submit");
const conciergeAvatar =
  document.querySelector<HTMLImageElement>("#concierge-avatar");
const conciergeName =
  document.querySelector<HTMLElement>("#concierge-name");
const conciergeRole =
  document.querySelector<HTMLElement>("#concierge-role");
const aiGuideSuggestions = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-prompt]"),
);
const aiGuideContextChoices =
  document.querySelector<HTMLElement>("#ai-guide-context-choices");
const journeySettingsToggle =
  document.querySelector<HTMLButtonElement>("#journey-settings-toggle");
const journeySettingsPanel =
  document.querySelector<HTMLElement>("#journey-settings-panel");
const journeyTransferPace =
  document.querySelector<HTMLSelectElement>("#journey-transfer-pace");
const journeyRankingPreference =
  document.querySelector<HTMLSelectElement>("#journey-ranking-preference");
const trainDetails = document.querySelector<HTMLElement>("#train-details");
const closeTrainDetails = document.querySelector<HTMLButtonElement>("#close-train-details");
const selectedTrainTitle = document.querySelector<HTMLElement>("#selected-train-title");
const selectedTrainDelay = document.querySelector<HTMLElement>("#selected-train-delay");
const selectedTrainStopping = document.querySelector<HTMLElement>("#selected-train-stopping");
const selectedTrainStops = document.querySelector<HTMLOListElement>("#selected-train-stops");
const trainDetailTabs = document.querySelector<HTMLElement>("#train-detail-tabs");
const metrics = new RuntimeMetrics();

if (
  app === null ||
  loadingScreenElement === null ||
  loadingScreenMessage === null ||
  loadingScreenRetry === null ||
  status === null ||
  displayTime === null ||
  dateTimeInput === null ||
  dateTimeDate === null ||
  dateTimeClock === null ||
  playToggle === null ||
  currentTimeButton === null ||
  playbackSpeed === null ||
  playbackSpeedMenuToggle === null ||
  playbackSpeedOptions === null ||
  playbackSpeedButtons.length === 0 ||
  mapTools === null ||
  weatherButtons.length !== 4 ||
  weatherMenuToggle === null ||
  weatherOptions === null ||
  congestionToggle === null ||
  destinationArcsToggle === null ||
  digitalTwinModeToggle === null ||
  aiGuidePanel === null ||
  aiGuideToggle === null ||
  closeAiGuide === null ||
  aiGuideMessages === null ||
  aiGuideForm === null ||
  aiGuideInput === null ||
  aiGuideSubmit === null ||
  aiGuideContextChoices === null ||
  conciergeAvatar === null ||
  conciergeName === null ||
  conciergeRole === null ||
  journeySettingsToggle === null ||
  journeySettingsPanel === null ||
  journeyTransferPace === null ||
  journeyRankingPreference === null ||
  trainDetails === null ||
  closeTrainDetails === null ||
  selectedTrainTitle === null ||
  selectedTrainDelay === null ||
  selectedTrainStopping === null ||
  selectedTrainStops === null ||
  trainDetailTabs === null
) {
  throw new Error("A required viewer element is missing.");
}

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
let activeConcierge = selectConciergeForUserProfile(loadUserProfile(localStorage));
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
updateConciergeIdentity(true);
document.addEventListener(travelProfileChangedEvent, () =>
  updateConciergeIdentity(true));
const aiGuideController = configureAiGuidePanel(
  {
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
  },
  (prompt, preferences) => handleAiGuidePrompt(prompt, preferences),
);
configureTravelProfile(document, () => aiGuideController.open());

const initialDateTime = new Date();
let displayedServiceDateStart = operatingServiceDateStart(initialDateTime);
const initialRouteTime = currentRouteTime(initialDateTime);
app.dataset.uiColorMode = uiColorModeForLightPreset(
  lightPresetForRouteTime(initialRouteTime),
);
displayTime.value = String(initialRouteTime);
renderDisplayDateTime(initialDateTime);

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
            digitalTwinModeToggle,
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
          renderDisplayDateTime(displayedAt);
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
          const response = await searchTravelCandidates({
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
          const response = await searchTravelCandidates({
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
        });
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
        let previousJourneyPlan: ViewerAgentJourneyPlan | undefined;
        let pendingJourneyLegChange: PendingJourneyLegChange | undefined;
        let pendingJourneyGuidance: JourneyNavigationGuidance | undefined;
        const localAiGuidePromptHandler = createLocalViewerAgent({
          trains: trainIndex.trains,
          getTrains: () => displayTrains,
          getPositions: () => displayedPositions,
          getRouteTime: () => Number(displayTime.value),
          setRouteTime: (routeTimeMinutes) =>
            applyViewerAgentActions(
              [{ type: "set_display_time", routeTimeMinutes }],
              selection.focusTrain,
            ),
          focusTrain: selection.focusTrain,
          setWeather: selectWeather,
          setLayerVisibility,
          searchDirectRoutes: localSearchRoutes,
          getPendingJourneyGuidance: () => pendingJourneyGuidance,
          maximumRouteTime,
        });
        handleAiGuidePrompt = async (prompt, preferences) => {
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
                setRouteTime: (routeTimeMinutes) =>
                  applyViewerAgentActions(
                    [{ type: "set_display_time", routeTimeMinutes }],
                    selection.focusTrain,
                  ),
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
                conciergeInstruction: buildConciergePrompt(activeConcierge),
                maximumRouteTime,
              },
              invokeBedrockAgent,
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

function renderDisplayDateTime(date: Date): void {
  if (dateTimeInput === null || dateTimeDate === null || dateTimeClock === null) {
    return;
  }

  const labels = displayDateTimeLabels(date);
  dateTimeDate.textContent = labels.date;
  const [hour, minute, second] = labels.time.split(":");
  const primaryTime = document.createElement("span");
  primaryTime.textContent = `${hour}:${minute}`;
  const seconds = document.createElement("small");
  seconds.textContent = `:${second}`;
  dateTimeClock.replaceChildren(primaryTime, seconds);
  dateTimeClock.dateTime = date.toISOString();
  if (document.activeElement !== dateTimeInput) {
    dateTimeInput.value = formatDateTimeLocal(date);
  }
}

function formatDateTimeLocal(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function formatServiceDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function maximumRouteTimeFor(
  trains: Array<{ stops: Array<{ route_time_minutes?: number }> }>,
): number {
  let maximumRouteTime = 24 * 60;

  for (const train of trains) {
    for (const stop of train.stops) {
      if (typeof stop.route_time_minutes === "number") {
        maximumRouteTime = Math.max(maximumRouteTime, stop.route_time_minutes);
      }
    }
  }

  return maximumRouteTime;
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

function applyViewerAgentActions(
  value: unknown,
  focusTrain: (serviceUid: string) => boolean,
): void {
  for (const action of parseViewerAgentActions(value)) {
    if (action.type === "set_display_time") {
      if (!displayTime) {
        throw new Error("表示時刻を操作できません。");
      }
      displayTime.value = String(action.routeTimeMinutes);
      displayTime.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (action.type === "focus_train") {
      focusTrain(action.serviceUid);
    }
  }
}

function configureDateTimeInput(
  input: HTMLInputElement,
  getDate: () => Date,
  setDate: (date: Date) => void,
): void {
  const display = input.closest<HTMLElement>(".date-time-display");
  const control = input.closest<HTMLElement>(".time-control");
  if (!display || !control) {
    throw new Error("表示日時コントロールが見つかりません。");
  }
  const picker = createDateTimePicker();
  control.append(picker.element);
  display.setAttribute("aria-controls", picker.element.id);

  let selectedDate = getDate();
  let visibleMonth = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    1,
  );
  const close = () => {
    picker.element.hidden = true;
    display.ariaExpanded = "false";
  };
  const render = () => {
    picker.month.textContent = `${visibleMonth.getFullYear()}年${visibleMonth.getMonth() + 1}月`;
    picker.days.replaceChildren(...calendarDayButtons(
      visibleMonth,
      selectedDate,
      (date) => {
        selectedDate = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          selectedDate.getHours(),
          selectedDate.getMinutes(),
          selectedDate.getSeconds(),
        );
        render();
      },
    ));
    picker.hour.value = String(selectedDate.getHours()).padStart(2, "0");
    picker.minute.value = String(selectedDate.getMinutes()).padStart(2, "0");
    picker.second.value = String(selectedDate.getSeconds()).padStart(2, "0");
  };
  const open = () => {
    if (input.disabled) {
      return;
    }
    selectedDate = getDate();
    visibleMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    render();
    picker.element.hidden = false;
    display.ariaExpanded = "true";
  };

  input.disabled = false;
  input.value = formatDateTimeLocal(getDate());
  display.addEventListener("click", (event) => {
    event.preventDefault();
    if (picker.element.hidden) {
      open();
    } else {
      close();
    }
  });
  display.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    } else if (event.key === "Escape") {
      close();
    }
  });
  picker.previous.addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    render();
  });
  picker.next.addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    render();
  });
  picker.cancel.addEventListener("click", close);
  picker.apply.addEventListener("click", () => {
    selectedDate.setHours(
      boundedNumber(picker.hour.value, 0, 23),
      boundedNumber(picker.minute.value, 0, 59),
      boundedNumber(picker.second.value, 0, 59),
      0,
    );
    setDate(selectedDate);
    close();
  });
  picker.element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      display.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!control.contains(event.target as Node)) {
      close();
    }
  });
}

interface DateTimePickerElements {
  element: HTMLElement;
  month: HTMLElement;
  days: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  hour: HTMLSelectElement;
  minute: HTMLSelectElement;
  second: HTMLSelectElement;
  cancel: HTMLButtonElement;
  apply: HTMLButtonElement;
}

function createDateTimePicker(): DateTimePickerElements {
  const element = document.createElement("section");
  element.id = "date-time-picker";
  element.className = "date-time-picker";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "表示日時を選択");
  element.hidden = true;
  const hours = timeSelectOptions(23);
  const minutesAndSeconds = timeSelectOptions(59);
  element.innerHTML = `
    <header>
      <strong class="date-time-picker-month"></strong>
      <span class="date-time-picker-navigation">
        <button type="button" data-picker-action="previous" aria-label="前の月"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 5-5 5 5 5"/></svg></button>
        <button type="button" data-picker-action="next" aria-label="次の月"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5"/></svg></button>
      </span>
    </header>
    <div class="date-time-picker-weekdays" aria-hidden="true"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>
    <div class="date-time-picker-days" role="grid"></div>
    <div class="date-time-picker-time" aria-label="時刻">
      <label><select data-picker-time="hour" aria-label="時">${hours}</select></label>
      <b aria-hidden="true">:</b>
      <label><select data-picker-time="minute" aria-label="分">${minutesAndSeconds}</select></label>
      <b aria-hidden="true">:</b>
      <label><select data-picker-time="second" aria-label="秒">${minutesAndSeconds}</select></label>
    </div>
    <footer>
      <button type="button" data-picker-action="cancel" aria-label="閉じる" title="閉じる"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg></button>
      <button type="button" data-picker-action="apply" aria-label="この日時に変更" title="この日時に変更"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg></button>
    </footer>`;
  const required = <T extends Element>(selector: string): T => {
    const value = element.querySelector<T>(selector);
    if (!value) throw new Error(`日時ピッカー要素が見つかりません: ${selector}`);
    return value;
  };
  return {
    element,
    month: required(".date-time-picker-month"),
    days: required(".date-time-picker-days"),
    previous: required('[data-picker-action="previous"]'),
    next: required('[data-picker-action="next"]'),
    hour: required('[data-picker-time="hour"]'),
    minute: required('[data-picker-time="minute"]'),
    second: required('[data-picker-time="second"]'),
    cancel: required('[data-picker-action="cancel"]'),
    apply: required('[data-picker-action="apply"]'),
  };
}

function timeSelectOptions(maximum: number): string {
  return Array.from({ length: maximum + 1 }, (_, value) => {
    const label = String(value).padStart(2, "0");
    return `<option value="${label}">${label}</option>`;
  }).join("");
}

function calendarDayButtons(
  month: Date,
  selected: Date,
  select: (date: Date) => void,
): HTMLButtonElement[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "gridcell");
    button.textContent = String(date.getDate());
    button.dataset.outsideMonth = String(date.getMonth() !== month.getMonth());
    button.ariaSelected = String(
      date.getFullYear() === selected.getFullYear() &&
      date.getMonth() === selected.getMonth() &&
      date.getDate() === selected.getDate(),
    );
    button.addEventListener("click", () => select(date));
    return button;
  });
}

function boundedNumber(value: string, minimum: number, maximum: number): number {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
}

interface PlaybackSpeedUiController {
  setEnabled(enabled: boolean): void;
  selectRealtimeSpeed(): void;
}

interface PlaybackUiController {
  setDigitalTwinMode(enabled: boolean): void;
}

function configurePlayback(
  updateTrains: (routeTime?: number) => void,
  maximumRouteTime: number,
  onCurrentDateSelected: (date: Date) => void,
  onOperatingDayWrapped: () => void,
  speedControls: PlaybackSpeedUiController,
): PlaybackUiController {
  if (
    displayTime === null ||
    playToggle === null ||
    currentTimeButton === null ||
    playbackSpeed === null
  ) {
    throw new Error("Playback controls are missing.");
  }

  const range = { minimum: Number(displayTime.min), maximum: maximumRouteTime };
  const controller = new PlaybackController({
    initialRouteTime: Number(displayTime.value),
    range,
    getMinutesPerSecond: () => Number(playbackSpeed.value),
    render: (routeTime) => {
      displayTime.value = String(routeTime);
      updateTrains(routeTime);
    },
    onOperatingDayWrapped,
    // 全量の列車位置計算とGeoJSON更新は30fpsを上限にする。
    minimumRenderIntervalMilliseconds:
      minimumPlaybackRenderIntervalMilliseconds,
  });
  const renderPlaybackState = () => {
    const playing = controller.isPlaying();
    setMapToolIcon(playToggle, playing ? "icon-pause" : "icon-play");
    playToggle.ariaLabel = playing ? "一時停止" : "再生";
    playToggle.title = playing ? "一時停止" : "再生";
  };
  const digitalTwinClock = createDigitalTwinClockSynchronizer((now) => {
    onCurrentDateSelected(now);
    const routeTime = currentRouteTime(now);
    controller.synchronize(
      Math.min(Math.max(routeTime, range.minimum), range.maximum),
    );
  }, browserDigitalTwinClockEnvironment());

  displayTime.addEventListener("input", () => {
    // 描画は既存のinputリスナーが行い、再生基準だけを移動する。
    controller.seek(Number(displayTime.value), false);
  });
  playToggle.addEventListener("click", () => {
    if (playToggle.disabled) {
      return;
    }
    if (controller.isPlaying()) {
      controller.stop();
    } else {
      controller.start();
    }
    renderPlaybackState();
  });
  currentTimeButton.addEventListener("click", () => {
    const now = new Date();
    onCurrentDateSelected(now);
    const routeTime = currentRouteTime(now);
    controller.seek(
      Math.min(Math.max(routeTime, range.minimum), range.maximum),
    );
  });

  controller.start();
  renderPlaybackState();
  let digitalTwinMode: boolean | undefined;
  return {
    setDigitalTwinMode(enabled) {
      if (enabled === digitalTwinMode) {
        return;
      }
      digitalTwinMode = enabled;
      digitalTwinClock.setEnabled(enabled);
      if (enabled) {
        speedControls.selectRealtimeSpeed();
        controller.start();
      }
      playToggle.disabled = enabled;
      playToggle.title = enabled
        ? "デジタルツインモードでは常時再生"
        : controller.isPlaying() ? "一時停止" : "再生";
      playToggle.ariaLabel = playToggle.title;
      speedControls.setEnabled(!enabled);
      setMapToolIcon(
        playToggle,
        controller.isPlaying() ? "icon-pause" : "icon-play",
      );
    },
  };
}

function configurePlaybackSpeed(
  value: HTMLInputElement,
  buttons: HTMLButtonElement[],
  menuToggle: HTMLButtonElement,
  options: HTMLFieldSetElement,
): PlaybackSpeedUiController {
  const closeMenu = () => {
    options.hidden = true;
    menuToggle.ariaExpanded = "false";
  };
  const selectSpeed = (speed: string, label: string) => {
    value.value = speed;
    menuToggle.textContent = label;
    menuToggle.ariaLabel = `再生速度を選択（現在は${label.replace("×", "倍")}）`;
    menuToggle.title = `再生速度: ${label.replace("×", "倍")}`;
    for (const button of buttons) {
      button.ariaPressed = String(button.dataset.playbackSpeed === speed);
    }
    closeMenu();
  };

  menuToggle.disabled = false;
  menuToggle.addEventListener("click", () => {
    const open = options.hidden;
    options.hidden = !open;
    menuToggle.ariaExpanded = String(open);
  });
  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const speed = button.dataset.playbackSpeed;
      const label = button.dataset.playbackSpeedLabel;
      if (speed && label) {
        selectSpeed(speed, label);
      }
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target instanceof Node &&
      !options.contains(target) &&
      !menuToggle.contains(target)
    ) {
      closeMenu();
    }
  });

  const selectedButton = buttons.find(
    (button) => button.dataset.playbackSpeed === value.value,
  );
  selectSpeed(
    value.value,
    selectedButton?.dataset.playbackSpeedLabel ?? "1×",
  );
  return {
    setEnabled(enabled) {
      menuToggle.disabled = !enabled;
      for (const button of buttons) {
        button.disabled = !enabled;
      }
      if (!enabled) {
        closeMenu();
      }
    },
    selectRealtimeSpeed() {
      const realtimeButton = buttons.find(
        (button) => button.dataset.playbackSpeedLabel === "1×",
      );
      selectSpeed(
        realtimeButton?.dataset.playbackSpeed ?? "0.016666666666666666",
        realtimeButton?.dataset.playbackSpeedLabel ?? "1×",
      );
    },
  };
}

function configureWeather(
  map: mapboxgl.Map,
  buttons: HTMLButtonElement[],
  menuToggle: HTMLButtonElement,
  options: HTMLFieldSetElement,
  onWeatherChanged: (mode: WeatherMode) => void,
): (mode: WeatherMode) => void {
  const weatherPresentation: Record<
    WeatherMode,
    { icon: string; label: string }
  > = {
    clear: { icon: "icon-sun", label: "晴れ" },
    cloudy: { icon: "icon-cloud", label: "曇り" },
    rain: { icon: "icon-rain", label: "雨" },
    snow: { icon: "icon-snow", label: "雪" },
  };
  const closeMenu = () => {
    options.hidden = true;
    menuToggle.ariaExpanded = "false";
  };
  const selectWeather = (mode: WeatherMode) => {
    applyWeather(map, mode);
    onWeatherChanged(mode);
    for (const button of buttons) {
      button.ariaPressed = String(button.dataset.weather === mode);
    }
    const presentation = weatherPresentation[mode];
    setMapToolIcon(menuToggle, presentation.icon);
    menuToggle.ariaLabel = `天気を選択（現在は${presentation.label}）`;
    menuToggle.title = `天気: ${presentation.label}`;
    closeMenu();
  };

  menuToggle.disabled = false;
  menuToggle.addEventListener("click", () => {
    const open = options.hidden;
    options.hidden = !open;
    menuToggle.ariaExpanded = String(open);
  });
  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const mode = button.dataset.weather;
      if (isWeatherMode(mode)) {
        selectWeather(mode);
      }
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target instanceof Node &&
      !options.contains(target) &&
      !menuToggle.contains(target)
    ) {
      closeMenu();
    }
  });

  selectWeather("clear");
  return selectWeather;
}

function setMapToolIcon(button: HTMLButtonElement, symbolId: string): void {
  button
    .querySelector<SVGUseElement>("use")
    ?.setAttribute("href", `#${symbolId}`);
}

function configureTrainCongestionUpdates(
  trainLayer: MapboxThreeTrainLayer,
  toggle: HTMLButtonElement,
): RealtimeVisualizationController & { dispose(): void } {
  let requested = true;
  let available = false;
  const poller = createPollingController(
    {
      load: loadTrainCongestion,
      apply: (snapshot) => {
        trainLayer.setCongestionByTrainNumber(snapshot.byTrainNumber);
      },
      onError: (error) =>
        console.warn("列車混雑情報を更新できませんでした。", error),
      refreshIntervalMilliseconds: congestionRefreshIntervalMilliseconds,
      retryIntervalMilliseconds: congestionRetryIntervalMilliseconds,
    },
    browserPollingEnvironment(),
  );

  const apply = () => {
    const visible = available && requested;
    toggle.disabled = !available;
    toggle.ariaPressed = String(visible);
    toggle.title = available ? "混雑表示" : "デジタルツインモードで利用可能";
    toggle.ariaLabel = available
      ? "混雑表示"
      : "混雑表示はデジタルツインモードで利用可能";
    trainLayer.setCongestionVisible(visible);
    poller.setEnabled(visible);
  };
  const setEnabled = (nextEnabled: boolean) => {
    requested = nextEnabled;
    apply();
  };

  const handleToggle = () => {
    setEnabled(!requested);
  };
  toggle.addEventListener("click", handleToggle);
  apply();

  return {
    setEnabled,
    setAvailable: (nextAvailable) => {
      available = nextAvailable;
      apply();
    },
    dispose: () => {
      toggle.removeEventListener("click", handleToggle);
      poller.dispose();
    },
  };
}

function configureTrainDelayUpdates(
  onUpdate: (snapshot: TrainDelaySnapshot) => void,
): () => void {
  const poller = createPollingController(
    {
      load: loadTrainDelays,
      apply: (snapshot) => {
        if (snapshot.failedSources.length > 0) {
          console.warn(
            "[TransitForge] 遅延スナップショットが不完全なためシミュレーション表示を維持します。",
            {
              collectedAt: snapshot.collectedAt,
              failedSources: snapshot.failedSources,
            },
          );
          return;
        }
        onUpdate(snapshot);
      },
      onError: (error) =>
        console.warn("列車遅延情報を更新できませんでした。", error),
      refreshIntervalMilliseconds: trainDelayRefreshIntervalMilliseconds,
      retryIntervalMilliseconds: trainDelayRetryIntervalMilliseconds,
    },
    browserPollingEnvironment(),
  );
  return poller.dispose;
}

function renderDisplayMode(
  toggle: HTMLButtonElement,
  realtimeAvailable: boolean,
  mode: "digital-twin" | "simulation",
): void {
  if (app === null) {
    return;
  }
  const digitalTwinMode = mode === "digital-twin";
  app.dataset.displayMode = mode;
  if (dateTimeInput) {
    dateTimeInput.disabled = digitalTwinMode;
    const display = dateTimeInput.closest<HTMLElement>(".date-time-display");
    display?.setAttribute("aria-disabled", String(digitalTwinMode));
    if (digitalTwinMode) {
      const picker = document.querySelector<HTMLElement>("#date-time-picker");
      if (picker) picker.hidden = true;
      if (display) display.ariaExpanded = "false";
    }
  }
  if (currentTimeButton) {
    currentTimeButton.hidden = digitalTwinMode;
  }
  toggle.disabled = !realtimeAvailable;
  toggle.ariaPressed = String(digitalTwinMode);
  if (!realtimeAvailable) {
    toggle.ariaLabel = "リアルタイム情報がないためシミュレーションモード";
    toggle.title = "リアルタイム情報がないためシミュレーションモード";
  } else if (digitalTwinMode) {
    toggle.ariaLabel = "デジタルツインモードを終了";
    toggle.title = "デジタルツインモード: オン";
  } else {
    toggle.ariaLabel = "デジタルツインモードを開始";
    toggle.title = "デジタルツインモード: オフ";
  }
}

interface RealtimeVisualizationController {
  setEnabled(enabled: boolean): void;
  setAvailable(available: boolean): void;
}

interface VisualizationController {
  setEnabled(enabled: boolean): void;
}

function configureDestinationArcs(
  trainLayer: MapboxThreeTrainLayer,
  toggle: HTMLButtonElement,
): VisualizationController {
  let requested = false;
  const apply = () => {
    toggle.disabled = false;
    toggle.ariaPressed = String(requested);
    toggle.title = "行先アーチ";
    toggle.ariaLabel = "行先アーチ";
    trainLayer.setDestinationArcsVisible(requested);
  };
  const setEnabled = (nextEnabled: boolean) => {
    requested = nextEnabled;
    apply();
  };

  toggle.addEventListener("click", () => {
    setEnabled(!requested);
  });
  apply();
  return { setEnabled };
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
