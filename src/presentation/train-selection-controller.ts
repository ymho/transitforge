import type { Train } from "../data/train-index";
import { coupledTrainLayouts } from "../domain/coupled-train-layout";
import { TrainFocusSession } from "../domain/train-focus-session";
import type { TrainPosition } from "../domain/train-position";
import type { MapboxThreeTrainLayer } from "../rendering/mapbox-three-train-layer";
import { timetableProgressRowsFor } from "./train-timetable";
import { trainTitleFor } from "./train-title";

export interface TrainSelectionElements {
  details: HTMLElement;
  close: HTMLButtonElement;
  title: HTMLElement;
  number: HTMLElement;
  delay: HTMLElement;
  stops: HTMLOListElement;
  showCoupled: HTMLButtonElement;
}

export interface TrainSelectionController {
  focusTrain: (serviceUid: string) => boolean;
  updateTracking: (positions: TrainPosition[]) => void;
  updateDelays: (delays: ReadonlyMap<string, number>) => void;
}

export function configureTrainSelection(
  map: mapboxgl.Map,
  trains: Train[],
  trainLayer: MapboxThreeTrainLayer,
  colorsByServiceUid: ReadonlyMap<string, string>,
  elements: TrainSelectionElements,
): TrainSelectionController {
  const trainsByServiceUid = new Map(
    trains.map((train) => [train.service_uid, train]),
  );
  const coupledServiceUidByServiceUid = new Map<string, string>();
  const focusSession = new TrainFocusSession();
  let delaysByTrainNumber = new Map<string, number>();
  let displayedPositions: TrainPosition[] = [];
  let timetableRenderSignature = "";

  const endFocus = () => {
    focusSession.end();
    trainLayer.setFocusedServiceUid(undefined);
    map.stop();
    elements.details.hidden = true;
    elements.showCoupled.hidden = true;
    elements.showCoupled.dataset.serviceUid = "";
    timetableRenderSignature = "";
  };

  const updateCoupledTrainButton = (serviceUid: string) => {
    const coupledServiceUid = coupledServiceUidByServiceUid.get(serviceUid);
    const coupledTrain = coupledServiceUid
      ? trainsByServiceUid.get(coupledServiceUid)
      : undefined;
    elements.showCoupled.hidden = coupledTrain === undefined;
    elements.showCoupled.dataset.serviceUid = coupledTrain?.service_uid ?? "";
    const coupledTitle = coupledTrain ? trainTitleFor(coupledTrain) : undefined;
    elements.showCoupled.textContent = coupledTitle ? "連結列車" : "";
    elements.showCoupled.ariaLabel = coupledTitle
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
    elements.stops.replaceChildren(...items);
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
    elements.title.replaceChildren(badge, mainTitle);
    if (title.suffix) {
      const suffix = document.createElement("small");
      suffix.className = "train-destination-suffix";
      suffix.textContent = title.suffix;
      elements.title.append(suffix);
    }
    elements.title.style.setProperty(
      "--train-line-color",
      colorsByServiceUid.get(train.service_uid) ?? "#a8aaad",
    );
    elements.number.textContent = train.train_no || "不明";
    const delay = delaysByTrainNumber.get(train.train_no);
    elements.delay.textContent =
      delay === undefined ? "情報なし" : delay > 0 ? `${delay}分` : "遅れなし";
    elements.details.hidden = false;
    renderTrainTimetable(
      train,
      displayedPositions.find(({ serviceUid: id }) => id === serviceUid),
      delay,
    );
    focusSession.start(train.service_uid);
    trainLayer.setFocusedServiceUid(train.service_uid);
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
  elements.close.addEventListener("click", endFocus);
  elements.showCoupled.addEventListener("click", () => {
    const serviceUid = elements.showCoupled.dataset.serviceUid;
    if (serviceUid) {
      showTrainDetails(serviceUid);
    }
  });

  return {
    focusTrain(serviceUid) {
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
    updateTracking(positions) {
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
      elements.details.hidden = false;
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
    updateDelays(delays) {
      delaysByTrainNumber = new Map(delays);
      const focusedServiceUid = focusSession.serviceUid;
      if (focusedServiceUid) {
        showTrainDetails(focusedServiceUid);
      }
    },
  };
}
