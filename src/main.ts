import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./style.css";
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
} from "./data/train-delay";
import {
  invokeBedrockAgent,
  queryDailyCongestionAnalysis,
  queryTrainDelayAnalysis,
  searchRepresentativeTimetable,
} from "./data/bedrock-agent";
import { loadTrainIndex, type Train } from "./data/train-index";
import type { StationCoordinate } from "./data/station-line-catalog";
import {
  nearestDirectOrigin, searchDirectRoutes, stationNamesFromCatalog,
} from "./domain/direct-route-search";
import {
  dateForOperatingRouteTime,
  operatingServiceDateStart,
  stepDisplayDateTime,
  type DisplayDateTimeUnit,
} from "./domain/display-date-time";
import { lightPresetForRouteTime, type LightPreset } from "./domain/map-lighting";
import {
  applyWeather,
  isWeatherMode,
  type WeatherMode,
} from "./domain/map-weather";
import { dominantLineColorsByPathId } from "./domain/path-line-colors";
import {
  advanceRouteTime,
  currentRouteTime,
  operatingDayStartMinutes,
} from "./domain/playback";
import { TrainFocusSession } from "./domain/train-focus-session";
import { coupledTrainLayouts } from "./domain/coupled-train-layout";
import { congestionAnalysisForAgent } from "./domain/congestion-analysis";
import { delayAnalysisForAgent } from "./domain/delay-analysis";
import { TrainLineColorIndex } from "./domain/train-line-color";
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
import {
  localViewerControlActionsFromPrompt,
  routeTimeFromPrompt,
  searchActiveTrainsFromPrompt,
  searchTrainArrivalsFromPrompt,
} from "./domain/viewer-agent-local-tools";
import {
  configureAiGuidePanel,
  type AiGuidePromptHandler,
} from "./presentation/ai-guide-panel";
import {
  configureRouteSearchPanel,
  type RouteSearchHandler,
} from "./presentation/route-search-panel";
import { timetableProgressRowsFor } from "./presentation/train-timetable";
import { trainTitleFor } from "./presentation/train-title";
import { MapboxThreeTrainLayer } from "./rendering/mapbox-three-train-layer";
import { RuntimeMetrics } from "./observability/runtime-metrics";

const minimumPlaybackRenderIntervalMilliseconds = 1_000 / 30;
const metricsLogIntervalMilliseconds = 10_000;
let nextMetricsLogTimestamp = 0;

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const dateTimePanel = document.querySelector<HTMLElement>("#date-time-panel");
const status = document.querySelector<HTMLParagraphElement>("#map-status");
const displayTime = document.querySelector<HTMLInputElement>("#display-time");
const dateTimeSummary =
  document.querySelector<HTMLOutputElement>("#date-time-summary");
const displayMonth = document.querySelector<HTMLOutputElement>("#display-month");
const displayDay = document.querySelector<HTMLOutputElement>("#display-day");
const displayHour = document.querySelector<HTMLOutputElement>("#display-hour");
const displayMinute = document.querySelector<HTMLOutputElement>("#display-minute");
const displaySecond = document.querySelector<HTMLOutputElement>("#display-second");
const dateTimeStepButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-date-time-unit]"),
);
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
const routeSearchPanel = document.querySelector<HTMLElement>("#route-search-panel");
const routeSearchToggle = document.querySelector<HTMLButtonElement>("#route-search-toggle");
const closeRouteSearch = document.querySelector<HTMLButtonElement>("#close-route-search");
const routeSearchForm = document.querySelector<HTMLFormElement>("#route-search-form");
const routeOrigin = document.querySelector<HTMLInputElement>("#route-origin");
const routeDestination = document.querySelector<HTMLInputElement>("#route-destination");
const routeDepartureTime = document.querySelector<HTMLInputElement>("#route-departure-time");
const routeSearchSubmit = document.querySelector<HTMLButtonElement>("#route-search-submit");
const routeSearchStatus = document.querySelector<HTMLElement>("#route-search-status");
const routeSearchResults = document.querySelector<HTMLOListElement>("#route-search-results");
const routeStations = document.querySelector<HTMLDataListElement>("#route-stations");
const trainDetails = document.querySelector<HTMLElement>("#train-details");
const closeTrainDetails = document.querySelector<HTMLButtonElement>("#close-train-details");
const selectedTrainTitle = document.querySelector<HTMLElement>("#selected-train-title");
const selectedTrainNumber = document.querySelector<HTMLElement>("#selected-train-number");
const selectedTrainDelay = document.querySelector<HTMLElement>("#selected-train-delay");
const selectedTrainStops = document.querySelector<HTMLOListElement>("#selected-train-stops");
const showCoupledTrain = document.querySelector<HTMLButtonElement>("#show-coupled-train");
const metrics = new RuntimeMetrics();

if (
  dateTimePanel === null ||
  status === null ||
  displayTime === null ||
  dateTimeSummary === null ||
  displayMonth === null ||
  displayDay === null ||
  displayHour === null ||
  displayMinute === null ||
  displaySecond === null ||
  dateTimeStepButtons.length !== 10 ||
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
  aiGuidePanel === null ||
  aiGuideToggle === null ||
  closeAiGuide === null ||
  aiGuideMessages === null ||
  aiGuideForm === null ||
  aiGuideInput === null ||
  aiGuideSubmit === null ||
  aiGuideSuggestions.length === 0 ||
  routeSearchPanel === null ||
  routeSearchToggle === null ||
  closeRouteSearch === null ||
  routeSearchForm === null ||
  routeOrigin === null ||
  routeDestination === null ||
  routeDepartureTime === null ||
  routeSearchSubmit === null ||
  routeSearchStatus === null ||
  routeSearchResults === null ||
  routeStations === null ||
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

configureDateTimePanel(dateTimePanel);
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
displayTime.value = String(initialRouteTime);
renderDisplayDateTime(initialDateTime);

if (!token) {
  status.textContent =
    "Mapbox公開トークンがありません。.env.localにVITE_MAPBOX_ACCESS_TOKENを設定してください。";
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

  map.on("style.load", async () => {
    status.hidden = false;
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
      const routeLoadStartedAt = performance.now();
      const catalog = await loadPathCatalog();
      metrics.recordRouteLoad(performance.now() - routeLoadStartedAt);
      logMetrics();

      status.textContent = "列車を読み込んでいます。";
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
        await nextFrame();
      }

      const maximumRouteTime = maximumRouteTimeFor(trainIndex.trains);
      displayTime.max = String(Math.ceil(maximumRouteTime / 60) * 60);

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
        const setCongestionVisible = configureTrainCongestionUpdates(
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
        );
        let displayedPositions: TrainPosition[] = [];

        const updateTrains = (routeTime = Number(displayTime.value)) => {
          const lightPreset = lightPresetForRouteTime(routeTime);
          if (lightPreset !== activeLightPreset) {
            map.setConfigProperty("basemap", "lightPreset", lightPreset);
            activeLightPreset = lightPreset;
          }
          const updateStartedAt = performance.now();
          const positions = activeTrainPositions(trainIndex.trains, geometry, routeTime);
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
          renderDisplayDateTime(
            dateForOperatingRouteTime(displayedServiceDateStart, routeTime),
          );
          status.hidden = true;
          metrics.recordPositionUpdate(performance.now() - updateStartedAt, positions.length);
          logMetrics();
        };

        const searchRoutes: RouteSearchHandler = async (request) => {
          let originStation = request.originStation;
          let distanceMeters: number | undefined;
          if (!originStation) {
            const coordinate = await currentBrowserCoordinate();
            const nearest = nearestDirectOrigin(
              trainIndex.trains,
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
          return {
            originStation,
            ...(distanceMeters === undefined ? {} : { distanceMeters }),
            results: searchDirectRoutes(
              trainIndex.trains,
              originStation,
              request.destinationStation,
              request.departureTimeMinutes,
            ),
          };
        };
        const routePanel = configureRouteSearchPanel(
          {
            panel: routeSearchPanel,
            toggle: routeSearchToggle,
            close: closeRouteSearch,
            form: routeSearchForm,
            origin: routeOrigin,
            destination: routeDestination,
            departureTime: routeDepartureTime,
            submit: routeSearchSubmit,
            status: routeSearchStatus,
            results: routeSearchResults,
            stations: routeStations,
          },
          stationNamesFromCatalog(stationLineCatalog),
          () => Number(displayTime.value),
          searchRoutes,
          (result) => {
            displayTime.value = String(result.departureTimeMinutes);
            updateTrains(result.departureTimeMinutes);
            selection.focusTrain(result.train.service_uid);
            routePanel.close();
          },
        );
        routeSearchToggle.disabled = false;
        routeSearchToggle.addEventListener("click", () => {
          if (routeSearchToggle.ariaExpanded === "true") {
            aiGuidePanel.hidden = true;
            aiGuideToggle.ariaExpanded = "false";
          }
        });
        aiGuideToggle.addEventListener("click", () => {
          if (aiGuideToggle.ariaExpanded === "true") routePanel.close();
        });

        configureTrainDelayUpdates((delays) => {
          threeTrainLayer.setDelayByTrainNumber(delays);
          selection.updateDelays(delays);
        });

        displayTime.addEventListener("input", () => updateTrains());
        configureDateTimeSteppers(
          dateTimeStepButtons,
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
        const localAiGuidePromptHandler = createLocalAiGuidePromptHandler(
          trainIndex.trains,
          () => displayedPositions,
          selection.focusTrain,
          selectWeather,
          setLayerVisibility,
          maximumRouteTime,
        );
        handleAiGuidePrompt = async (prompt) => {
          try {
            return await runBedrockViewerAgent(
              prompt,
              {
                trains: trainIndex.trains,
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
                searchDirectRoutes: searchRoutes,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラーです。";
      status.hidden = false;
      status.textContent = `入力を読み込めませんでした: ${message}`;
    }
  });

  map.on("error", (event) => {
    status.hidden = false;
    status.textContent = `地図の読み込みに失敗しました: ${event.error.message}`;
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

function formatRouteTime(routeTimeMinutes: number): string {
  const totalSeconds = Math.round(routeTimeMinutes * 60);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return seconds === 0 ? base : `${base}:${String(seconds).padStart(2, "0")}`;
}

function renderDisplayDateTime(date: Date): void {
  if (
    dateTimeSummary === null ||
    displayMonth === null ||
    displayDay === null ||
    displayHour === null ||
    displayMinute === null ||
    displaySecond === null
  ) {
    return;
  }

  dateTimeSummary.value =
    `${date.getMonth() + 1}月${date.getDate()}日 ` +
    `${date.getHours()}時${String(date.getMinutes()).padStart(2, "0")}分` +
    `${String(date.getSeconds()).padStart(2, "0")}秒`;
  displayMonth.value = String(date.getMonth() + 1).padStart(2, "0");
  displayDay.value = String(date.getDate()).padStart(2, "0");
  displayHour.value = String(date.getHours()).padStart(2, "0");
  displayMinute.value = String(date.getMinutes()).padStart(2, "0");
  displaySecond.value = String(date.getSeconds()).padStart(2, "0");
}

function configureDateTimeSteppers(
  buttons: HTMLButtonElement[],
  getDate: () => Date,
  setDate: (date: Date) => void,
): void {
  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const unit = button.dataset.dateTimeUnit;
      const amount = Number(button.dataset.dateTimeStep);
      if (isDisplayDateTimeUnit(unit) && (amount === 1 || amount === -1)) {
        setDate(stepDisplayDateTime(getDate(), unit, amount));
      }
    });
  }
}

function isDisplayDateTimeUnit(
  value: string | undefined,
): value is DisplayDateTimeUnit {
  return (
    value === "month" ||
    value === "day" ||
    value === "hour" ||
    value === "minute" ||
    value === "second"
  );
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

function createLocalAiGuidePromptHandler(
  trains: Train[],
  getPositions: () => TrainPosition[],
  focusTrain: (serviceUid: string) => boolean,
  setWeather: (weather: WeatherMode) => void,
  setLayerVisibility: (layer: ViewerAgentLayer, visible: boolean) => void,
  maximumRouteTime: number,
): AiGuidePromptHandler {
  return async (prompt) => {
    const responseParts: string[] = [];
    const controlActions = localViewerControlActionsFromPrompt(prompt);
    for (const action of controlActions) {
      if (action.type === "set_weather") {
        setWeather(action.weather);
        const weatherLabel = {
          clear: "晴れ",
          cloudy: "曇り",
          rain: "雨",
          snow: "雪",
        }[action.weather];
        responseParts.push(`天気を${weatherLabel}に設定しました。`);
      } else if (action.type === "set_layer_visibility") {
        setLayerVisibility(action.layer, action.visible);
        const layerLabel =
          action.layer === "congestion" ? "混雑棒" : "目的地アーチ";
        responseParts.push(
          `${layerLabel}を${action.visible ? "表示" : "非表示に"}しました。`,
        );
      }
    }

    const arrivalSearch = searchTrainArrivalsFromPrompt(prompt, trains);
    if (
      arrivalSearch.hasSearchTerms &&
      arrivalSearch.targetTimeMinutes !== undefined
    ) {
      const rangeStart =
        Math.max(
          operatingDayStartMinutes,
          arrivalSearch.targetTimeMinutes - arrivalSearch.windowMinutes,
        );
      const rangeEnd =
        Math.min(
          maximumRouteTime,
          arrivalSearch.targetTimeMinutes + arrivalSearch.windowMinutes,
        );
      if (arrivalSearch.matches.length === 0) {
        responseParts.push(
          `${formatRouteTime(rangeStart)}〜${formatRouteTime(rangeEnd)}に条件に合う到着列車は見つかりませんでした。`,
        );
      } else {
        const arrivals = arrivalSearch.matches.map(({ train, arrivalTimeMinutes }) => {
          const title = trainTitleFor(train);
          return `${formatRouteTime(arrivalTimeMinutes)} ${title.main}${title.suffix ?? ""}`;
        });
        responseParts.push(
          `${formatRouteTime(rangeStart)}〜${formatRouteTime(rangeEnd)}の到着列車です。\n${arrivals.join("\n")}`,
        );
        if (arrivalSearch.totalMatchCount > arrivalSearch.matches.length) {
          responseParts.push(
            `ほかに${arrivalSearch.totalMatchCount - arrivalSearch.matches.length}件あります。`,
          );
        }
      }
      return responseParts.join("\n");
    }

    const requestedRouteTime = routeTimeFromPrompt(prompt);
    if (requestedRouteTime !== undefined) {
      const routeTime = Math.min(requestedRouteTime, maximumRouteTime);
      applyViewerAgentActions(
        [{ type: "set_display_time", routeTimeMinutes: routeTime }],
        focusTrain,
      );
      responseParts.push(`表示時刻を${formatRouteTime(routeTime)}に変更しました。`);
    }

    const routeTime = Number(displayTime?.value ?? 0);
    const search = searchActiveTrainsFromPrompt(
      prompt,
      trains,
      getPositions(),
      routeTime,
    );

    if (search.hasSearchTerms) {
      const first = search.matches[0];
      if (!first) {
        responseParts.push(
          `${formatRouteTime(routeTime)}に運行中の条件に合う列車は見つかりませんでした。`,
        );
      } else {
        const [focusAction] = parseViewerAgentActions([
          { type: "focus_train", serviceUid: first.train.service_uid },
        ]);
        const focused =
          focusAction?.type === "focus_train" &&
          focusTrain(focusAction.serviceUid);
        const title = trainTitleFor(first.train);
        const fullTitle = `${title.main}${title.suffix ?? ""}`;
        responseParts.push(
          focused
            ? `${fullTitle}を選択し、列車の位置へ移動しました。`
            : `${fullTitle}は見つかりましたが、現在位置へ移動できませんでした。`,
        );
        if (search.totalMatchCount > 1) {
          responseParts.push(
            `条件に合う列車はほかに${search.totalMatchCount - 1}件あります。`,
          );
        }
      }
    }

    if (responseParts.length === 0) {
      return "時刻、駅名、列車種別、列車名、列車番号を含めて依頼してください。例:「18時30分に京都へ向かう特急を見せて」";
    }
    return responseParts.join("\n");
  };
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

function configureDateTimePanel(panel: HTMLElement): void {
  const setEditing = (editing: boolean) => {
    panel.dataset.editing = String(editing);
    panel.ariaExpanded = String(editing);
    panel.ariaLabel = editing
      ? "表示日時を編集中。パネルの余白を押すと閉じます"
      : "表示日時。押すと日時を変更できます";
  };

  panel.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button")) {
      return;
    }
    setEditing(panel.dataset.editing !== "true");
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setEditing(false);
    } else if (
      (event.key === "Enter" || event.key === " ") &&
      event.target === panel
    ) {
      event.preventDefault();
      setEditing(panel.dataset.editing !== "true");
    }
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Node && !panel.contains(target)) {
      setEditing(false);
    }
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

  let playing = false;
  let animationFrame: number | undefined;
  let lastTimestamp: number | undefined;
  let lastRenderedTimestamp: number | undefined;
  let playbackRouteTime = Number(displayTime.value);
  const range = { minimum: Number(displayTime.min), maximum: maximumRouteTime };

  const setRouteTime = (routeTime: number) => {
    playbackRouteTime = routeTime;
    displayTime.value = String(routeTime);
    updateTrains(routeTime);
  };

  const stop = () => {
    playing = false;
    lastTimestamp = undefined;
    lastRenderedTimestamp = undefined;
    if (animationFrame !== undefined) {
      cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    }
    setMapToolIcon(playToggle, "icon-play");
    playToggle.ariaLabel = "再生";
    playToggle.title = "再生";
  };

  const tick = (timestamp: number) => {
    if (!playing) {
      return;
    }

    if (lastTimestamp !== undefined) {
      const minutesPerSecond = Number(playbackSpeed.value);
      const nextRouteTime = advanceRouteTime(
        playbackRouteTime,
        timestamp - lastTimestamp,
        minutesPerSecond,
        range,
      );
      if (nextRouteTime < playbackRouteTime) {
        onOperatingDayWrapped();
      }
      playbackRouteTime = nextRouteTime;
      // 全量の列車位置計算とGeoJSON更新を毎フレーム行うと負荷が大きい。
      // 30fpsを上限として、20fpsだった更新より滑らかに再生する。
      if (
        lastRenderedTimestamp === undefined ||
        timestamp - lastRenderedTimestamp >= minimumPlaybackRenderIntervalMilliseconds
      ) {
        displayTime.value = String(playbackRouteTime);
        updateTrains(playbackRouteTime);
        lastRenderedTimestamp = timestamp;
      }
    }

    lastTimestamp = timestamp;
    animationFrame = requestAnimationFrame(tick);
  };

  const start = () => {
    if (playing) {
      return;
    }

    playing = true;
    lastTimestamp = undefined;
    setMapToolIcon(playToggle, "icon-pause");
    playToggle.ariaLabel = "一時停止";
    playToggle.title = "一時停止";
    animationFrame = requestAnimationFrame(tick);
  };

  displayTime.addEventListener("input", () => {
    if (playing) {
      stop();
    }
    playbackRouteTime = Number(displayTime.value);
  });
  playToggle.addEventListener("click", () => {
    if (playing) {
      stop();
      return;
    }

    start();
  });
  currentTimeButton.addEventListener("click", () => {
    const now = new Date();
    onCurrentDateSelected(now);
    const routeTime = currentRouteTime(now);
    setRouteTime(Math.min(Math.max(routeTime, range.minimum), range.maximum));
  });

  start();
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
): (enabled: boolean) => void {
  let timer: number | undefined;
  let nextRefreshAt = Date.now();
  let refreshing = false;
  let enabled = true;

  const schedule = (delayMilliseconds: number) => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    nextRefreshAt = Date.now() + delayMilliseconds;
    if (enabled && document.visibilityState === "visible") {
      timer = window.setTimeout(() => void refresh(), delayMilliseconds);
    }
  };

  const refresh = async () => {
    if (!enabled || refreshing || document.visibilityState !== "visible") {
      return;
    }

    refreshing = true;
    try {
      const snapshot = await loadTrainCongestion();
      trainLayer.setCongestionByTrainNumber(snapshot.byTrainNumber);
      schedule(congestionRefreshIntervalMilliseconds);
    } catch (error) {
      console.warn("列車混雑情報を更新できませんでした。", error);
      schedule(congestionRetryIntervalMilliseconds);
    } finally {
      refreshing = false;
    }
  };

  const setEnabled = (nextEnabled: boolean) => {
    enabled = nextEnabled;
    toggle.ariaPressed = String(enabled);
    trainLayer.setCongestionVisible(enabled);

    if (!enabled) {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      return;
    }

    schedule(Math.max(0, nextRefreshAt - Date.now()));
  };

  toggle.disabled = false;
  toggle.addEventListener("click", () => {
    setEnabled(toggle.ariaPressed !== "true");
  });

  document.addEventListener("visibilitychange", () => {
    if (!enabled || document.visibilityState !== "visible") {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      return;
    }

    schedule(Math.max(0, nextRefreshAt - Date.now()));
  });

  void refresh();
  return setEnabled;
}

function configureTrainDelayUpdates(
  onUpdate: (delays: ReadonlyMap<string, number>) => void,
): void {
  let timer: number | undefined;
  let nextRefreshAt = Date.now();
  let refreshing = false;

  const schedule = (delayMilliseconds: number) => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    nextRefreshAt = Date.now() + delayMilliseconds;
    if (document.visibilityState === "visible") {
      timer = window.setTimeout(() => void refresh(), delayMilliseconds);
    }
  };

  const refresh = async () => {
    if (refreshing || document.visibilityState !== "visible") {
      return;
    }
    refreshing = true;
    try {
      const snapshot = await loadTrainDelays();
      onUpdate(snapshot.byTrainNumber);
      schedule(trainDelayRefreshIntervalMilliseconds);
    } catch (error) {
      console.warn("列車遅延情報を更新できませんでした。", error);
      schedule(trainDelayRetryIntervalMilliseconds);
    } finally {
      refreshing = false;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      return;
    }
    schedule(Math.max(0, nextRefreshAt - Date.now()));
  });

  void refresh();
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

function configureTrainSelection(
  map: mapboxgl.Map,
  trains: Train[],
  trainLayer: MapboxThreeTrainLayer,
  colorsByServiceUid: ReadonlyMap<string, string>,
): {
  focusTrain: (serviceUid: string) => boolean;
  updateTracking: (positions: TrainPosition[]) => void;
  updateDelays: (delays: ReadonlyMap<string, number>) => void;
} {
  if (
    trainDetails === null ||
    closeTrainDetails === null ||
    selectedTrainTitle === null ||
    selectedTrainNumber === null ||
    selectedTrainDelay === null ||
    selectedTrainStops === null ||
    showCoupledTrain === null
  ) {
    throw new Error("Train detail elements are missing.");
  }

  const trainsByServiceUid = new Map(trains.map((train) => [train.service_uid, train]));
  const coupledServiceUidByServiceUid = new Map<string, string>();
  const focusSession = new TrainFocusSession();
  let delaysByTrainNumber = new Map<string, number>();
  let displayedPositions: TrainPosition[] = [];
  let timetableRenderSignature = "";

  const endFocus = () => {
    focusSession.end();
    map.stop();
    trainDetails.hidden = true;
    showCoupledTrain.hidden = true;
    showCoupledTrain.dataset.serviceUid = "";
    timetableRenderSignature = "";
  };

  const updateCoupledTrainButton = (serviceUid: string) => {
    const coupledServiceUid = coupledServiceUidByServiceUid.get(serviceUid);
    const coupledTrain = coupledServiceUid
      ? trainsByServiceUid.get(coupledServiceUid)
      : undefined;
    showCoupledTrain.hidden = coupledTrain === undefined;
    showCoupledTrain.dataset.serviceUid = coupledTrain?.service_uid ?? "";
    const coupledTitle = coupledTrain ? trainTitleFor(coupledTrain) : undefined;
    showCoupledTrain.textContent = coupledTitle ? "連結列車" : "";
    showCoupledTrain.ariaLabel = coupledTitle
      ? `${coupledTitle.badge} ${coupledTitle.main}${coupledTitle.suffix ?? ""}の詳細を見る`
      : null;
  };

  const renderTrainTimetable = (
    train: Train,
    position: TrainPosition | undefined,
    delay: number | undefined,
  ) => {
    const rows = timetableProgressRowsFor(
      train.stops,
      position?.routeMeter,
      delay,
    );
    const currentRowIndex = rows.findIndex(({ status }) => status !== undefined);
    const currentStatus =
      currentRowIndex >= 0 ? rows[currentRowIndex]?.status : undefined;
    const signature = [
      train.service_uid,
      delay ?? "unknown",
      currentRowIndex,
      currentStatus ?? "none",
    ].join("|");
    if (signature === timetableRenderSignature) {
      return;
    }
    timetableRenderSignature = signature;

    let currentItem: HTMLLIElement | undefined;
    const items = rows.map(({ stationName, times, status }) => {
      const item = document.createElement("li");
      const station = document.createElement("span");
      const timeList = document.createElement("span");
      station.className = "train-timetable-station";
      timeList.className = "train-timetable-times";
      station.append(document.createTextNode(stationName));

      if (status) {
        item.dataset.currentStatus = status;
        currentItem = item;
      }

      for (const [index, { scheduled, adjusted }] of times.entries()) {
        const time = document.createElement("span");
        time.className = "train-timetable-time";
        const scheduledTime = document.createElement("span");
        scheduledTime.textContent = scheduled;
        if (adjusted) {
          scheduledTime.className = "train-timetable-scheduled-replaced";
          const adjustedTime = document.createElement("strong");
          adjustedTime.textContent = adjusted;
          time.append(scheduledTime, " → ", adjustedTime);
        } else {
          time.append(scheduledTime);
        }
        timeList.append(time);
        if (index < times.length - 1) {
          timeList.append(document.createTextNode(" / "));
        }
      }
      item.append(station, timeList);
      return item;
    });
    selectedTrainStops.replaceChildren(...items);
    currentItem?.scrollIntoView({ block: "center" });
  };

  const showTrainDetails = (serviceUid: string) => {
    const train = trainsByServiceUid.get(serviceUid);
    if (!train) {
      return;
    }

    const title = trainTitleFor(train);
    const badge = document.createElement("span");
    badge.className = "train-service-badge";
    badge.textContent = title.badge;
    const mainTitle = document.createElement("span");
    mainTitle.className = "train-title-main";
    mainTitle.textContent = title.main;
    selectedTrainTitle.replaceChildren(badge, mainTitle);
    if (title.suffix) {
      const suffix = document.createElement("small");
      suffix.className = "train-destination-suffix";
      suffix.textContent = title.suffix;
      selectedTrainTitle.append(suffix);
    }
    selectedTrainTitle.style.setProperty(
      "--train-line-color",
      colorsByServiceUid.get(train.service_uid) ?? "#a8aaad",
    );
    selectedTrainNumber.textContent = train.train_no || "不明";
    const delay = delaysByTrainNumber.get(train.train_no);
    selectedTrainDelay.textContent =
      delay === undefined ? "情報なし" : delay > 0 ? `${delay}分` : "遅れなし";
    trainDetails.hidden = false;
    renderTrainTimetable(
      train,
      displayedPositions.find(({ serviceUid: id }) => id === serviceUid),
      delay,
    );
    focusSession.start(train.service_uid);
    updateCoupledTrainButton(train.service_uid);
  };

  map.on("click", "train-hit-targets", (event) => {
    const serviceUid = event.features?.[0]?.properties?.service_uid;
    if (typeof serviceUid === "string") {
      showTrainDetails(serviceUid);
    }
  });
  map.on("click", (event) => {
    const congestionServiceUid = trainLayer.congestionBarServiceUidAt(
      event.point,
    );
    if (congestionServiceUid) {
      showTrainDetails(congestionServiceUid);
      return;
    }

    const clickedTrains = map.queryRenderedFeatures(event.point, {
      layers: ["train-hit-targets"],
    });
    if (clickedTrains.length === 0) {
      endFocus();
    }
  });
  map.on("mouseenter", "train-hit-targets", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "train-hit-targets", () => {
    map.getCanvas().style.cursor = "";
  });
  closeTrainDetails.addEventListener("click", () => {
    endFocus();
  });
  showCoupledTrain.addEventListener("click", () => {
    const serviceUid = showCoupledTrain.dataset.serviceUid;
    if (serviceUid) {
      showTrainDetails(serviceUid);
    }
  });

  return {
    focusTrain(serviceUid: string) {
      const position = displayedPositions.find(
        (candidate) => candidate.serviceUid === serviceUid,
      );
      if (!position || !trainsByServiceUid.has(serviceUid)) {
        return false;
      }

      showTrainDetails(serviceUid);
      map.easeTo({
        center: position.coordinate,
        zoom: Math.max(map.getZoom(), 14),
        duration: 750,
      });
      return true;
    },
    updateTracking(positions: TrainPosition[]) {
      displayedPositions = positions;
      coupledServiceUidByServiceUid.clear();
      for (const { position, coupledServiceUid } of coupledTrainLayouts(positions)) {
        if (coupledServiceUid) {
          coupledServiceUidByServiceUid.set(position.serviceUid, coupledServiceUid);
        }
      }

      const focusedServiceUid = focusSession.serviceUid;
      if (!focusedServiceUid) {
        return;
      }

      const position = positions.find(
        ({ serviceUid }) => serviceUid === focusedServiceUid,
      );
      if (!position) {
        endFocus();
        return;
      }

      // フォーカス中は詳細パネルと列車追跡を常に同じ状態に保つ。
      trainDetails.hidden = false;
      const train = trainsByServiceUid.get(focusedServiceUid);
      if (train) {
        renderTrainTimetable(
          train,
          position,
          delaysByTrainNumber.get(train.train_no),
        );
      }
      updateCoupledTrainButton(focusedServiceUid);
      map.jumpTo({ center: position.coordinate });
    },
    updateDelays(delays: ReadonlyMap<string, number>) {
      delaysByTrainNumber = new Map(delays);
      const focusedServiceUid = focusSession.serviceUid;
      if (focusedServiceUid) {
        showTrainDetails(focusedServiceUid);
      }
    },
  };
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
