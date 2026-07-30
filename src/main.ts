import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./style.css";
import {
  loadPathCatalog,
  toRouteFeatureCollections,
} from "./data/path-catalog";
import { loadStationLineCatalog } from "./data/station-line-catalog";
import {
  congestionRefreshIntervalMilliseconds,
  congestionRetryIntervalMilliseconds,
  loadTrainCongestion,
} from "./data/train-congestion";
import {
  invokeBedrockAgent,
  queryDailyCongestionPeak,
} from "./data/bedrock-agent";
import { loadTrainIndex, type Train } from "./data/train-index";
import { lightPresetForRouteTime, type LightPreset } from "./domain/map-lighting";
import {
  isSceneMode,
  lightPresetForSceneMode,
  sceneModeStyleFor,
  type SceneMode,
} from "./domain/map-scene-mode";
import {
  applyWeather,
  isWeatherMode,
  type WeatherMode,
} from "./domain/map-weather";
import { dominantLineColorsByPathId } from "./domain/path-line-colors";
import { advanceRouteTime, currentRouteTime } from "./domain/playback";
import { coupledTrainLayouts } from "./domain/coupled-train-layout";
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
  routeTimeFromPrompt,
  searchActiveTrainsFromPrompt,
} from "./domain/viewer-agent-local-tools";
import {
  configureAiGuidePanel,
  type AiGuidePromptHandler,
} from "./presentation/ai-guide-panel";
import { timetableRowsFor } from "./presentation/train-timetable";
import {
  trainServiceLabelFor,
  trainTitleFor,
} from "./presentation/train-title";
import { MapboxThreeTrainLayer } from "./rendering/mapbox-three-train-layer";
import { RuntimeMetrics } from "./observability/runtime-metrics";

const minimumPlaybackRenderIntervalMilliseconds = 1_000 / 30;

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const controlPanel = document.querySelector<HTMLElement>("#control-panel");
const controlPanelToggle =
  document.querySelector<HTMLButtonElement>("#control-panel-toggle");
const status = document.querySelector<HTMLParagraphElement>("#map-status");
const displayTime = document.querySelector<HTMLInputElement>("#display-time");
const timeLabel = document.querySelector<HTMLOutputElement>("#time-label");
const clockHourHand = document.querySelector<SVGLineElement>("#clock-hour-hand");
const clockMinuteHand = document.querySelector<SVGLineElement>("#clock-minute-hand");
const clockSecondHand = document.querySelector<SVGLineElement>("#clock-second-hand");
const playToggle = document.querySelector<HTMLButtonElement>("#play-toggle");
const realTimeToggle = document.querySelector<HTMLButtonElement>("#real-time-toggle");
const playbackSpeed = document.querySelector<HTMLSelectElement>("#playback-speed");
const sceneModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-scene-mode]"),
);
const weatherButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-weather]"),
);
const congestionToggle =
  document.querySelector<HTMLButtonElement>("#congestion-toggle");
const destinationArcsToggle =
  document.querySelector<HTMLButtonElement>("#destination-arcs-toggle");
const congestionLegend =
  document.querySelector<HTMLElement>("#congestion-legend");
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
const selectedTrainType = document.querySelector<HTMLElement>("#selected-train-type");
const selectedTrainRoute = document.querySelector<HTMLElement>("#selected-train-route");
const selectedTrainStops = document.querySelector<HTMLOListElement>("#selected-train-stops");
const showCoupledTrain = document.querySelector<HTMLButtonElement>("#show-coupled-train");
const metricDisplaySummary = document.querySelector<HTMLElement>("#metric-display-summary");
const metricRouteLoad = document.querySelector<HTMLElement>("#metric-route-load");
const metricTrainLoad = document.querySelector<HTMLElement>("#metric-train-load");
const metricPositionUpdate = document.querySelector<HTMLElement>("#metric-position-update");
const metricActiveTrains = document.querySelector<HTMLElement>("#metric-active-trains");
const metricFramesPerSecond = document.querySelector<HTMLElement>("#metric-fps");
const metricHeap = document.querySelector<HTMLElement>("#metric-heap");
const metrics = new RuntimeMetrics();

if (
  controlPanel === null ||
  controlPanelToggle === null ||
  status === null ||
  displayTime === null ||
  timeLabel === null ||
  clockHourHand === null ||
  clockMinuteHand === null ||
  clockSecondHand === null ||
  playToggle === null ||
  realTimeToggle === null ||
  playbackSpeed === null ||
  sceneModeButtons.length !== 2 ||
  weatherButtons.length !== 3 ||
  congestionToggle === null ||
  destinationArcsToggle === null ||
  congestionLegend === null ||
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
  selectedTrainType === null ||
  selectedTrainRoute === null ||
  selectedTrainStops === null ||
  showCoupledTrain === null ||
  metricDisplaySummary === null
) {
  throw new Error("A required viewer element is missing.");
}

configureControlPanelMinimization(controlPanel, controlPanelToggle);
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

const initialRouteTime = currentRouteTime(new Date());
displayTime.value = String(initialRouteTime);
timeLabel.textContent = formatRouteTime(initialRouteTime);
updateAnalogClock(initialRouteTime);

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
    pitch: 62,
    bearing: -18,
    antialias: true,
  });

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }));
  map.addControl(new mapboxgl.FullscreenControl());

  map.on("style.load", async () => {
    status.hidden = false;
    map.setConfigProperty("basemap", "show3dObjects", true);
    map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
    map.setConfigProperty("basemap", "showPlaceLabels", false);
    map.setConfigProperty("basemap", "showRoadLabels", false);
    map.setConfigProperty("basemap", "showTransitLabels", true);
    const selectWeather = configureWeather(map, weatherButtons);
    monitorFrames();
    let activeLightPreset: LightPreset | undefined;
    let activeSceneMode: SceneMode = "normal";

    try {
      status.textContent = "全経路を読み込んでいます。";
      const routeLoadStartedAt = performance.now();
      const catalog = await loadPathCatalog();
      metrics.recordRouteLoad(performance.now() - routeLoadStartedAt);
      renderMetrics();

      status.textContent = "列車と駅・路線カタログを読み込んでいます。";
      const trainLoadStartedAt = performance.now();
      const [trainIndex, stationLineCatalog] = await Promise.all([
        loadTrainIndex(),
        loadStationLineCatalog(),
      ]);
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
      renderMetrics();
      const routeLayerIds: string[] = [];

      for (const [index, routes] of routeCollections.entries()) {
        const sourceId = `routes-${index}`;
        routeLayerIds.push(sourceId);
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
        map.addLayer(threeTrainLayer);
        const setDestinationArcsVisible = configureDestinationArcs(
          threeTrainLayer,
          destinationArcsToggle,
        );
        const setCongestionVisible = configureTrainCongestionUpdates(
          threeTrainLayer,
          congestionToggle,
          congestionLegend,
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
        );
        let displayedPositions: TrainPosition[] = [];

        const updateTrains = (routeTime = Number(displayTime.value)) => {
          const lightPreset = lightPresetForSceneMode(
            activeSceneMode,
            lightPresetForRouteTime(routeTime),
          );
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
          timeLabel.textContent = formatRouteTime(routeTime);
          updateAnalogClock(routeTime);
          metricDisplaySummary.textContent =
            `${catalog.paths.length.toLocaleString("ja-JP")}経路と` +
            `${positions.length.toLocaleString("ja-JP")}列車を表示中です。`;
          status.hidden = true;
          metrics.recordPositionUpdate(performance.now() - updateStartedAt, positions.length);
          renderMetrics();
        };

        displayTime.addEventListener("input", () => updateTrains());
        const selectSceneMode = configureSceneModes(
          map,
          sceneModeButtons,
          routeLayerIds,
          (mode) => {
            activeSceneMode = mode;
            activeLightPreset = undefined;
            updateTrains();
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
                setSceneMode: selectSceneMode,
                setLayerVisibility,
                queryDailyCongestionPeak,
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
        realTimeToggle.disabled = false;
        playbackSpeed.disabled = false;
        configurePlayback(updateTrains, maximumRouteTime);
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

function formatRouteTime(routeTimeMinutes: number): string {
  const totalSeconds = Math.round(routeTimeMinutes * 60);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return seconds === 0 ? base : `${base}:${String(seconds).padStart(2, "0")}`;
}

function updateAnalogClock(routeTimeMinutes: number): void {
  if (
    clockHourHand === null ||
    clockMinuteHand === null ||
    clockSecondHand === null
  ) {
    return;
  }

  const minutesInDay = 24 * 60;
  const normalizedMinutes =
    ((routeTimeMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hourAngle = normalizedMinutes * 0.5;
  const minuteAngle = (normalizedMinutes % 60) * 6;
  const secondAngle = ((normalizedMinutes * 60) % 60) * 6;

  clockHourHand.setAttribute("transform", `rotate(${hourAngle} 60 53)`);
  clockMinuteHand.setAttribute("transform", `rotate(${minuteAngle} 60 53)`);
  clockSecondHand.setAttribute("transform", `rotate(${secondAngle} 60 53)`);
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
  maximumRouteTime: number,
): AiGuidePromptHandler {
  return async (prompt) => {
    const requestedRouteTime = routeTimeFromPrompt(prompt);
    const responseParts: string[] = [];

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

function configureControlPanelMinimization(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
): void {
  const setMinimized = (minimized: boolean) => {
    panel.dataset.minimized = String(minimized);
    toggle.ariaExpanded = String(!minimized);
    toggle.ariaLabel = minimized
      ? "操作パネルを元に戻す"
      : "操作パネルを最小化";
    toggle.textContent = minimized ? "＋" : "−";
  };

  toggle.addEventListener("click", () => {
    setMinimized(panel.dataset.minimized !== "true");
  });
}

function configurePlayback(
  updateTrains: (routeTime?: number) => void,
  maximumRouteTime: number,
): void {
  if (
    displayTime === null ||
    playToggle === null ||
    realTimeToggle === null ||
    playbackSpeed === null
  ) {
    throw new Error("Playback controls are missing.");
  }

  let playing = false;
  let animationFrame: number | undefined;
  let realTimeTimer: number | undefined;
  let lastTimestamp: number | undefined;
  let lastRenderedTimestamp: number | undefined;
  let playbackRouteTime = Number(displayTime.value);
  const range = { minimum: Number(displayTime.min), maximum: maximumRouteTime };

  const setRouteTime = (routeTime: number) => {
    playbackRouteTime = routeTime;
    displayTime.value = String(Math.round(routeTime));
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
    if (realTimeTimer !== undefined) {
      clearInterval(realTimeTimer);
      realTimeTimer = undefined;
    }
    playToggle.textContent = "再生";
    realTimeToggle.textContent = "現在時刻";
  };

  const tick = (timestamp: number) => {
    if (!playing) {
      return;
    }

    if (lastTimestamp !== undefined) {
      const minutesPerSecond = Number(playbackSpeed.value);
      playbackRouteTime = advanceRouteTime(
        playbackRouteTime,
        timestamp - lastTimestamp,
        minutesPerSecond,
        range,
      );
      // 全量の列車位置計算とGeoJSON更新を毎フレーム行うと負荷が大きい。
      // 30fpsを上限として、20fpsだった更新より滑らかに再生する。
      if (
        lastRenderedTimestamp === undefined ||
        timestamp - lastRenderedTimestamp >= minimumPlaybackRenderIntervalMilliseconds
      ) {
        displayTime.value = String(Math.round(playbackRouteTime));
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

    if (realTimeTimer !== undefined) {
      stop();
    }
    playing = true;
    lastTimestamp = undefined;
    playToggle.textContent = "一時停止";
    animationFrame = requestAnimationFrame(tick);
  };

  displayTime.addEventListener("input", () => {
    if (playing || realTimeTimer !== undefined) {
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
  realTimeToggle.addEventListener("click", () => {
    if (realTimeTimer !== undefined) {
      stop();
      return;
    }

    stop();
    const synchronize = () => {
      const now = new Date();
      const currentRouteTime = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
      setRouteTime(Math.min(Math.max(currentRouteTime, range.minimum), range.maximum));
    };
    synchronize();
    realTimeToggle.textContent = "現在時刻を停止";
    realTimeTimer = window.setInterval(synchronize, 1_000);
  });

  start();
}

function configureWeather(
  map: mapboxgl.Map,
  buttons: HTMLButtonElement[],
): (mode: WeatherMode) => void {
  const selectWeather = (mode: WeatherMode) => {
    applyWeather(map, mode);
    for (const button of buttons) {
      button.ariaPressed = String(button.dataset.weather === mode);
    }
  };

  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const mode = button.dataset.weather;
      if (isWeatherMode(mode)) {
        selectWeather(mode);
      }
    });
  }

  selectWeather("clear");
  return selectWeather;
}

function configureTrainCongestionUpdates(
  trainLayer: MapboxThreeTrainLayer,
  toggle: HTMLButtonElement,
  legend: HTMLElement,
): (enabled: boolean) => void {
  let timer: number | undefined;
  let nextRefreshAt = Date.now();
  let refreshing = false;
  let enabled = true;
  let hasData = false;

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
      hasData = true;
      legend.hidden = !enabled;
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
    legend.hidden = !enabled || !hasData;

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

function configureSceneModes(
  map: mapboxgl.Map,
  buttons: HTMLButtonElement[],
  routeLayerIds: string[],
  onModeChange: (mode: SceneMode) => void,
): (mode: SceneMode) => void {
  let normalView: { pitch: number; bearing: number } | undefined;
  let selectedMode: SceneMode = "normal";

  const selectMode = (mode: SceneMode) => {
    if (mode === selectedMode) {
      return;
    }

    const style = sceneModeStyleFor(mode);
    map.setConfigProperty("basemap", "theme", style.theme);
    for (const layerId of routeLayerIds) {
      map.setPaintProperty(layerId, "line-width", style.routeLineWidth);
      map.setPaintProperty(layerId, "line-opacity", style.routeLineOpacity);
    }

    if (mode === "model") {
      normalView = {
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      };
      map.easeTo({ pitch: 52, bearing: 0, duration: 700 });
    } else if (normalView) {
      map.easeTo({ ...normalView, duration: 700 });
      normalView = undefined;
    }

    for (const button of buttons) {
      button.ariaPressed = String(button.dataset.sceneMode === mode);
    }
    selectedMode = mode;
    onModeChange(mode);
  };

  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const mode = button.dataset.sceneMode;
      if (isSceneMode(mode)) {
        selectMode(mode);
      }
    });
  }
  return selectMode;
}

function configureTrainSelection(
  map: mapboxgl.Map,
  trains: import("./data/train-index").Train[],
  trainLayer: MapboxThreeTrainLayer,
): {
  focusTrain: (serviceUid: string) => boolean;
  updateTracking: (positions: TrainPosition[]) => void;
} {
  if (
    trainDetails === null ||
    closeTrainDetails === null ||
    selectedTrainTitle === null ||
    selectedTrainNumber === null ||
    selectedTrainType === null ||
    selectedTrainRoute === null ||
    selectedTrainStops === null ||
    showCoupledTrain === null
  ) {
    throw new Error("Train detail elements are missing.");
  }

  const trainsByServiceUid = new Map(trains.map((train) => [train.service_uid, train]));
  const coupledServiceUidByServiceUid = new Map<string, string>();
  let trackedServiceUid: string | undefined;
  let displayedPositions: TrainPosition[] = [];

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
      ? `${coupledTitle.main}${coupledTitle.suffix ?? ""}の詳細を見る`
      : null;
  };

  const showTrainDetails = (serviceUid: string) => {
    const train = trainsByServiceUid.get(serviceUid);
    if (!train) {
      return;
    }

    const title = trainTitleFor(train);
    selectedTrainTitle.replaceChildren(document.createTextNode(title.main));
    if (title.suffix) {
      const suffix = document.createElement("small");
      suffix.className = "train-destination-suffix";
      suffix.textContent = title.suffix;
      selectedTrainTitle.append(suffix);
    }
    selectedTrainNumber.textContent = train.train_no || "不明";
    selectedTrainType.textContent = trainServiceLabelFor(train);
    selectedTrainRoute.textContent = `${train.origin_station} → ${train.destination_station}`;
    selectedTrainStops.replaceChildren(
      ...timetableRowsFor(train.stops).map(({ stationName, times }) => {
        const item = document.createElement("li");
        const station = document.createElement("span");
        const time = document.createElement("span");
        station.textContent = stationName;
        time.textContent = times.join(" / ");
        item.append(station, time);
        return item;
      }),
    );
    trackedServiceUid = train.service_uid;
    updateCoupledTrainButton(train.service_uid);
    trainDetails.hidden = false;
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
      trackedServiceUid = undefined;
      trainDetails.hidden = true;
    }
  });
  map.on("mouseenter", "train-hit-targets", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "train-hit-targets", () => {
    map.getCanvas().style.cursor = "";
  });
  closeTrainDetails.addEventListener("click", () => {
    trainDetails.hidden = true;
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

      if (!trackedServiceUid) {
        return;
      }

      const position = positions.find(({ serviceUid }) => serviceUid === trackedServiceUid);
      if (!position) {
        trackedServiceUid = undefined;
        trainDetails.hidden = true;
        return;
      }

      updateCoupledTrainButton(trackedServiceUid);
      map.jumpTo({ center: position.coordinate });
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
        renderMetrics();
        nextRenderTimestamp = timestamp + 500;
      }
    }
    previousTimestamp = timestamp;
    requestAnimationFrame(record);
  };

  requestAnimationFrame(record);
}

function renderMetrics(): void {
  const snapshot = metrics.getSnapshot();
  setMetric(metricRouteLoad, formatMilliseconds(snapshot.routeLoadMilliseconds));
  setMetric(metricTrainLoad, formatMilliseconds(snapshot.trainLoadMilliseconds));
  setMetric(metricPositionUpdate, formatMilliseconds(snapshot.positionUpdateMilliseconds));
  setMetric(metricActiveTrains, snapshot.activeTrainCount.toLocaleString("ja-JP"));
  setMetric(metricFramesPerSecond, snapshot.framesPerSecond ? `${snapshot.framesPerSecond.toFixed(0)} fps` : "—");
  setMetric(metricHeap, formatHeapUsage());
}

function setMetric(element: HTMLElement | null, value: string): void {
  if (element) {
    element.textContent = value;
  }
}

function formatMilliseconds(milliseconds: number | undefined): string {
  return milliseconds === undefined ? "—" : `${milliseconds.toFixed(1)} ms`;
}

function formatHeapUsage(): string {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? `${(memory.usedJSHeapSize / 1_048_576).toFixed(0)} MiB` : "未対応";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
