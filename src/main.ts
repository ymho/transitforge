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
  searchRepresentativeTimetable,
  searchTravelCandidates,
} from "./data/bedrock-agent";
import { loadTrainIndex } from "./data/train-index";
import type { StationCoordinate } from "./data/station-line-catalog";
import {
  nearestDirectOrigin, searchDirectRoutes,
  type DirectRouteSearchHandler,
} from "./domain/direct-route-search";
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
import {
  applyWeather,
  isWeatherMode,
  type WeatherMode,
} from "./domain/map-weather";
import { dominantLineColorsByPathId } from "./domain/path-line-colors";
import { currentRouteTime } from "./domain/playback";
import { PlaybackController } from "./domain/playback-controller";
import { congestionAnalysisForAgent } from "./domain/congestion-analysis";
import { delayAnalysisForAgent } from "./domain/delay-analysis";
import { TrainLineColorIndex } from "./domain/train-line-color";
import {
  delayByTrainNumber,
  destinationChangedTrainNumbers,
  operationsForDisplay,
  trainsForOperations,
} from "./domain/train-operation-state";
import {
  activeTrainPositions,
  destinationCoordinateForTrain,
  PathGeometryIndex,
} from "./domain/train-position";
import type { TrainPosition } from "./domain/train-position";
import {
  parseViewerAgentActions,
  type ViewerAgentLayer,
} from "./domain/viewer-agent-action";
import { runBedrockViewerAgent } from "./domain/viewer-agent-bedrock";
import { createLocalViewerAgent } from "./domain/viewer-agent-local";
import {
  configureAiGuidePanel,
  type AiGuidePromptHandler,
} from "./presentation/ai-guide-panel";
import { configureTrainSelection } from "./presentation/train-selection-controller";
import { createLoadingScreen } from "./presentation/loading-screen";
import { MapboxThreeTrainLayer } from "./rendering/mapbox-three-train-layer";
import { RuntimeMetrics } from "./observability/runtime-metrics";

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
const timetableModeToggle =
  document.querySelector<HTMLButtonElement>("#timetable-mode-toggle");
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
const aiGuideSuggestions = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-prompt]"),
);
const trainDetails = document.querySelector<HTMLElement>("#train-details");
const closeTrainDetails = document.querySelector<HTMLButtonElement>("#close-train-details");
const selectedTrainTitle = document.querySelector<HTMLElement>("#selected-train-title");
const selectedTrainNumber = document.querySelector<HTMLElement>("#selected-train-number");
const selectedTrainDelay = document.querySelector<HTMLElement>("#selected-train-delay");
const selectedTrainStops = document.querySelector<HTMLOListElement>("#selected-train-stops");
const showCoupledTrain = document.querySelector<HTMLButtonElement>("#show-coupled-train");
const metrics = new RuntimeMetrics();

if (
  app === null ||
  loadingScreenElement === null ||
  loadingScreenMessage === null ||
  loadingScreenRetry === null ||
  status === null ||
  displayTime === null ||
  dateTimeInput === null ||
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
  timetableModeToggle === null ||
  aiGuidePanel === null ||
  aiGuideToggle === null ||
  closeAiGuide === null ||
  aiGuideMessages === null ||
  aiGuideForm === null ||
  aiGuideInput === null ||
  aiGuideSubmit === null ||
  aiGuideSuggestions.length === 0 ||
  trainDetails === null ||
  closeTrainDetails === null ||
  selectedTrainTitle === null ||
  selectedTrainNumber === null ||
  selectedTrainDelay === null ||
  selectedTrainStops === null ||
  showCoupledTrain === null
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
configureAiGuidePanel(
  {
    panel: aiGuidePanel,
    toggle: aiGuideToggle,
    close: closeAiGuide,
    messages: aiGuideMessages,
    form: aiGuideForm,
    input: aiGuideInput,
    submit: aiGuideSubmit,
    suggestions: aiGuideSuggestions,
  },
  (prompt) => handleAiGuidePrompt(prompt),
);

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
  map.addControl(new mapboxgl.FullscreenControl());
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

        loadingScreen.setMessage("列車の初期位置を準備しています。");
        const threeTrainLayer = new MapboxThreeTrainLayer(
          colorsByServiceUid,
          destinationCoordinatesByServiceUid,
        );
        applyWeatherToTrains = (mode) => {
          threeTrainLayer.setCloudyAtmosphereEnabled(mode !== "clear");
        };
        applyWeatherToTrains(activeWeatherMode);
        map.addLayer(threeTrainLayer);
        const setDestinationArcsVisible = configureDestinationArcs(
          threeTrainLayer,
          destinationArcsToggle,
        );
        const congestionUpdates = configureTrainCongestionUpdates(
          threeTrainLayer,
          congestionToggle,
        );
        const setCongestionVisible = congestionUpdates.setEnabled;
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
          {
            details: trainDetails,
            close: closeTrainDetails,
            title: selectedTrainTitle,
            number: selectedTrainNumber,
            delay: selectedTrainDelay,
            stops: selectedTrainStops,
            showCoupled: showCoupledTrain,
          },
        );
        let displayedPositions: TrainPosition[] = [];
        let latestDelaySnapshot: TrainDelaySnapshot | undefined;
        let timetableModeRequested = false;
        let appliedOperations:
          | ReadonlyMap<string, TrainOperation>
          | undefined
          | null = null;
        let displayTrains = trainIndex.trains;
        let displayDelays: ReadonlyMap<string, number> = new Map();

        const applyOperationMode = (displayedAt: Date) => {
          const now = new Date();
          const realtimeOperations = operationsForDisplay(
            latestDelaySnapshot,
            displayedAt,
            now,
            false,
          );
          const operations = timetableModeRequested
            ? undefined
            : realtimeOperations;
          renderTimetableModeToggle(
            timetableModeToggle,
            realtimeOperations !== undefined,
            operations === undefined,
          );
          if (operations === appliedOperations) {
            return;
          }
          appliedOperations = operations;
          displayTrains = trainsForOperations(trainIndex.trains, operations);
          displayDelays = delayByTrainNumber(operations);
          const destinationChanges = destinationChangedTrainNumbers(
            trainIndex.trains,
            operations,
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
          selection.updateOperations(operations);
          console.info("[TransitForge] 列車表示モード", {
            mode: operations ? "realtime" : "timetable",
            timetableTrains: trainIndex.trains.length,
            displayedTrains: displayTrains.length,
            unobservedTimetableEntries: operations
              ? trainIndex.trains.length - displayTrains.length
              : 0,
            delayedTrains: [...displayDelays.values()].filter(
              (delay) => delay > 0,
            ).length,
            destinationChangedTrains: destinationChanges.size,
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
          const positions = activeTrainPositions(
            displayTrains,
            geometry,
            routeTime,
            displayDelays,
          );
          displayedPositions = positions;
          threeTrainLayer.setPositions(positions);
          selection.updateTracking(positions);
          const hitSource = map.getSource("train-hit-targets") as mapboxgl.GeoJSONSource;
          hitSource.setData({
            type: "FeatureCollection",
            features: positions.map((position) => ({
              type: "Feature" as const,
              properties: { service_uid: position.serviceUid },
              geometry: { type: "Point" as const, coordinates: position.coordinate },
            })),
          });
          renderDisplayDateTime(displayedAt);
          status.hidden = true;
          metrics.recordPositionUpdate(performance.now() - updateStartedAt, positions.length);
          logMetrics();
        };

        const resolveDirectRouteOrigin = async (request: Parameters<DirectRouteSearchHandler>[0]) => {
          let originStation = request.originStation;
          let distanceMeters: number | undefined;
          if (!originStation) {
            const coordinate = await currentBrowserCoordinate();
            const nearest = nearestDirectOrigin(
              displayTrains,
              stationLineCatalog,
              request.destinationStation,
              request.departureTimeMinutes,
              coordinate,
            );
            if (!nearest) {
              throw new Error(
                "現在地の近くから行き先へ直通する駅が見つかりません。出発駅を入力してください。",
              );
            }
            originStation = nearest.stationName;
            distanceMeters = nearest.distanceMeters;
          }
          return { originStation, distanceMeters };
        };
        const localSearchRoutes: DirectRouteSearchHandler = async (request) => {
          const { originStation, distanceMeters } = await resolveDirectRouteOrigin(request);
          return {
            originStation,
            ...(distanceMeters === undefined ? {} : { distanceMeters }),
            results: searchDirectRoutes(
              displayTrains,
              originStation,
              request.destinationStation,
              request.departureTimeMinutes,
            ),
          };
        };
        const backendSearchRoutes: DirectRouteSearchHandler = async (request) => {
          const { originStation, distanceMeters } = await resolveDirectRouteOrigin(request);
          const response = await searchTravelCandidates({
            serviceDate: formatServiceDate(displayedServiceDateStart),
            originStation,
            destinationStation: request.destinationStation,
            departureTimeMinutes: request.departureTimeMinutes,
            limit: 3,
          });
          const trainsByServiceUid = new Map(
            displayTrains.map((train) => [train.service_uid, train]),
          );
          return {
            originStation: response.originStation,
            ...(distanceMeters === undefined ? {} : { distanceMeters }),
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
        const disposeDelayUpdates = configureTrainDelayUpdates((snapshot) => {
          latestDelaySnapshot = snapshot;
          updateTrains();
        });
        disposeDataUpdates = () => {
          congestionUpdates.dispose();
          disposeDelayUpdates();
        };

        displayTime.addEventListener("input", () => updateTrains());
        timetableModeToggle.addEventListener("click", () => {
          if (timetableModeToggle.disabled) {
            return;
          }
          timetableModeRequested = timetableModeToggle.ariaPressed !== "true";
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
            setCongestionVisible(visible);
          } else {
            setDestinationArcsVisible(visible);
          }
        };
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
          maximumRouteTime,
        });
        handleAiGuidePrompt = async (prompt) => {
          try {
            return await runBedrockViewerAgent(
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
                maximumRouteTime,
              },
              invokeBedrockAgent,
            );
          } catch (error) {
            if (import.meta.env.DEV) {
              return localAiGuidePromptHandler(prompt);
            }
            throw error;
          }
        };
        displayTime.disabled = false;
        playToggle.disabled = false;
        currentTimeButton.disabled = false;
        configurePlaybackSpeed(
          playbackSpeed,
          playbackSpeedButtons,
          playbackSpeedMenuToggle,
          playbackSpeedOptions,
        );
        configurePlayback(
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
  if (dateTimeInput === null || document.activeElement === dateTimeInput) {
    return;
  }

  dateTimeInput.value = formatDateTimeLocal(date);
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

function parseDateTimeLocal(value: string): Date | undefined {
  const date = new Date(value);
  return value !== "" && !Number.isNaN(date.getTime()) ? date : undefined;
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
  input.disabled = false;
  input.value = formatDateTimeLocal(getDate());
  input.addEventListener("focus", () => {
    input.value = formatDateTimeLocal(getDate());
  });
  input.addEventListener("change", () => {
    const date = parseDateTimeLocal(input.value);
    if (date === undefined) {
      input.value = formatDateTimeLocal(getDate());
      return;
    }
    setDate(date);
  });
}

function configurePlayback(
  updateTrains: (routeTime?: number) => void,
  maximumRouteTime: number,
  onCurrentDateSelected: (date: Date) => void,
  onOperatingDayWrapped: () => void,
): void {
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

  displayTime.addEventListener("input", () => {
    // 描画は既存のinputリスナーが行い、再生基準だけを移動する。
    controller.seek(Number(displayTime.value), false);
  });
  playToggle.addEventListener("click", () => {
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
}

function configurePlaybackSpeed(
  value: HTMLInputElement,
  buttons: HTMLButtonElement[],
  menuToggle: HTMLButtonElement,
  options: HTMLFieldSetElement,
): void {
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
): { setEnabled(enabled: boolean): void; dispose(): void } {
  let enabled = true;
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

  const setEnabled = (nextEnabled: boolean) => {
    enabled = nextEnabled;
    toggle.ariaPressed = String(enabled);
    trainLayer.setCongestionVisible(enabled);
    poller.setEnabled(enabled);
  };

  toggle.disabled = false;
  const handleToggle = () => {
    setEnabled(toggle.ariaPressed !== "true");
  };
  toggle.addEventListener("click", handleToggle);

  return {
    setEnabled,
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
            "[TransitForge] 遅延スナップショットが不完全なため時刻表表示を維持します。",
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

function renderTimetableModeToggle(
  toggle: HTMLButtonElement,
  realtimeAvailable: boolean,
  timetableMode: boolean,
): void {
  toggle.disabled = !realtimeAvailable;
  toggle.ariaPressed = String(timetableMode);
  if (!realtimeAvailable) {
    toggle.ariaLabel = "リアルタイム情報がないため時刻表どおりに表示中";
    toggle.title = "リアルタイム情報がないため時刻表どおりに表示中";
  } else if (timetableMode) {
    toggle.ariaLabel = "リアルタイム表示に戻す";
    toggle.title = "リアルタイム表示に戻す";
  } else {
    toggle.ariaLabel = "時刻表どおりに表示";
    toggle.title = "時刻表どおりに表示";
  }
}

function configureDestinationArcs(
  trainLayer: MapboxThreeTrainLayer,
  toggle: HTMLButtonElement,
): (enabled: boolean) => void {
  const setEnabled = (enabled: boolean) => {
    toggle.ariaPressed = String(enabled);
    trainLayer.setDestinationArcsVisible(enabled);
  };

  toggle.disabled = false;
  toggle.addEventListener("click", () => {
    setEnabled(toggle.ariaPressed !== "true");
  });
  return setEnabled;
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
