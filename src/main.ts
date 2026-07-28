import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./style.css";
import {
  loadPathCatalog,
  toRouteFeatureCollections,
} from "./data/path-catalog";
import { loadStationLineCatalog } from "./data/station-line-catalog";
import { loadTrainIndex } from "./data/train-index";
import { lightPresetForRouteTime, type LightPreset } from "./domain/map-lighting";
import {
  applyWeather,
  isWeatherMode,
  type WeatherMode,
} from "./domain/map-weather";
import { dominantLineColorsByPathId } from "./domain/path-line-colors";
import { advanceRouteTime } from "./domain/playback";
import { coupledTrainLayouts } from "./domain/coupled-train-layout";
import { TrainLineColorIndex } from "./domain/train-line-color";
import { activeTrainPositions, PathGeometryIndex } from "./domain/train-position";
import type { TrainPosition } from "./domain/train-position";
import { timetableRowsFor } from "./presentation/train-timetable";
import {
  trainServiceLabelFor,
  trainTitleFor,
} from "./presentation/train-title";
import { MapboxThreeTrainLayer } from "./rendering/mapbox-three-train-layer";
import { RuntimeMetrics } from "./observability/runtime-metrics";

const minimumPlaybackRenderIntervalMilliseconds = 1_000 / 30;

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const status = document.querySelector<HTMLParagraphElement>("#map-status");
const displayTime = document.querySelector<HTMLInputElement>("#display-time");
const timeLabel = document.querySelector<HTMLOutputElement>("#time-label");
const clockHourHand = document.querySelector<SVGLineElement>("#clock-hour-hand");
const clockMinuteHand = document.querySelector<SVGLineElement>("#clock-minute-hand");
const clockSecondHand = document.querySelector<SVGLineElement>("#clock-second-hand");
const playToggle = document.querySelector<HTMLButtonElement>("#play-toggle");
const realTimeToggle = document.querySelector<HTMLButtonElement>("#real-time-toggle");
const playbackSpeed = document.querySelector<HTMLSelectElement>("#playback-speed");
const weatherButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-weather]"),
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
  status === null ||
  displayTime === null ||
  timeLabel === null ||
  clockHourHand === null ||
  clockMinuteHand === null ||
  clockSecondHand === null ||
  playToggle === null ||
  realTimeToggle === null ||
  playbackSpeed === null ||
  weatherButtons.length !== 3 ||
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
    configureWeather(map, weatherButtons);
    monitorFrames();
    let activeLightPreset: LightPreset | undefined;

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

        const threeTrainLayer = new MapboxThreeTrainLayer(colorsByServiceUid);
        map.addLayer(threeTrainLayer);
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
        const selection = configureTrainSelection(map, trainIndex.trains);

        const updateTrains = (routeTime = Number(displayTime.value)) => {
          const lightPreset = lightPresetForRouteTime(routeTime);
          if (lightPreset !== activeLightPreset) {
            map.setConfigProperty("basemap", "lightPreset", lightPreset);
            activeLightPreset = lightPreset;
          }
          const updateStartedAt = performance.now();
          const positions = activeTrainPositions(trainIndex.trains, geometry, routeTime);
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
): void {
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
}

function configureTrainSelection(
  map: mapboxgl.Map,
  trains: import("./data/train-index").Train[],
): { updateTracking: (positions: TrainPosition[]) => void } {
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
    updateTracking(positions: TrainPosition[]) {
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
