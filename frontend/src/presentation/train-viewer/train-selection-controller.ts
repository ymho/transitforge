import type { TrainOperation } from "@raiquora/operation/operation";
import type { Train } from "@raiquora/train/train";
import {
  coupledTrainLayouts,
  type TrainLinkKind,
} from "../../domain/coupled-train-layout";
import { TrainFocusSession } from "../../domain/train-focus-session";
import { mergeSameOperationTrains } from "../../domain/train-detail-service";
import { trainWithOperation } from "@raiquora/operation/train-operation-state";
import type { TrainPosition } from "../../domain/train-position";
import type { TrainFormationLink } from "../../domain/train-formation-link";
import {
  timetableDisplayTimeParts,
  timetableProgressRowsFor,
} from "./train-timetable";
import { hideSheet, showSheet } from "../shared/sheet-transition";
import { trainTitleFor } from "./train-title";

export interface TrainSelectionElements {
  details: HTMLElement;
  close: HTMLButtonElement;
  title: HTMLElement;
  stopping: HTMLElement;
  delay: HTMLElement;
  stops: HTMLOListElement;
  coupledTabs: HTMLElement;
  onFocus?: (serviceUid: string) => void;
  onEndFocus?: () => void;
}

export interface TrainSelectionController {
  focusTrain: (serviceUid: string) => boolean;
  updateTracking: (positions: TrainPosition[]) => void;
  updateOperations: (
    operations: ReadonlyMap<string, TrainOperation> | undefined,
    destinationChangedServiceUids?: ReadonlySet<string>,
  ) => void;
}

export interface TrainSelectionLayer {
  setFocusedServiceUid(serviceUid: string | undefined): void;
  congestionBarServiceUidAt(point: { x: number; y: number }): string | undefined;
}

export function configureTrainSelection(
  map: mapboxgl.Map,
  trains: Train[],
  trainLayer: TrainSelectionLayer,
  colorsByServiceUid: ReadonlyMap<string, string>,
  formationLinks: ReadonlyMap<string, TrainFormationLink>,
  elements: TrainSelectionElements,
): TrainSelectionController {
  const trainsByServiceUid = new Map(
    trains.map((train) => [train.service_uid, train]),
  );
  const coupledServiceUidByServiceUid = new Map<string, string>();
  const linkKindByServiceUid = new Map<string, TrainLinkKind>();
  const focusSession = new TrainFocusSession();
  let operationsByTrainNumber: ReadonlyMap<string, TrainOperation> | undefined;
  let destinationChangedServiceUids: ReadonlySet<string> = new Set();
  let displayedPositions: TrainPosition[] = [];
  let timetableRenderSignature = "";

  const endFocus = () => {
    focusSession.end();
    trainLayer.setFocusedServiceUid(undefined);
    map.stop();
    hideSheet(elements.details, () => {
      elements.coupledTabs.hidden = true;
      elements.coupledTabs.replaceChildren();
      elements.onEndFocus?.();
    });
    timetableRenderSignature = "";
  };

  const effectiveTrain = (train: Train): Train => {
    const operation = operationsByTrainNumber?.get(train.train_no);
    return operation
      ? trainWithOperation(
          train,
          operation,
          destinationChangedServiceUids.has(train.service_uid),
        )
      : train;
  };

  const detailTrainsFor = (serviceUid: string): Train[] => {
    const coupledServiceUid = coupledServiceUidByServiceUid.get(serviceUid);
    return (coupledServiceUid ? [serviceUid, coupledServiceUid] : [serviceUid])
      .map((id) => trainsByServiceUid.get(id))
      .filter((train): train is Train => train !== undefined)
      .map(effectiveTrain)
      .sort(
        (left, right) =>
          left.train_no.localeCompare(right.train_no, "ja", { numeric: true }) ||
          left.service_uid.localeCompare(right.service_uid),
      );
  };

  const renderCoupledTrainTabs = (serviceUid: string) => {
    const trains = detailTrainsFor(serviceUid);
    if (
      trains.length < 2 ||
      linkKindByServiceUid.get(serviceUid) !== "coupled-service"
    ) {
      elements.coupledTabs.hidden = true;
      elements.coupledTabs.replaceChildren();
      return;
    }

    const existingTabs = Array.from(
      elements.coupledTabs.querySelectorAll<HTMLButtonElement>("[role=tab]"),
    );
    const sameServices =
      existingTabs.length === trains.length &&
      existingTabs.every(
        (tab, index) => tab.dataset.serviceUid === trains[index]?.service_uid,
      );
    if (sameServices) {
      for (const tab of existingTabs) {
        tab.setAttribute(
          "aria-selected",
          String(tab.dataset.serviceUid === serviceUid),
        );
      }
      elements.coupledTabs.hidden = false;
      return;
    }

    const tabs = trains.map((train) => {
      const title = trainTitleFor(train);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(train.service_uid === serviceUid));
      tab.dataset.serviceUid = train.service_uid;
      tab.textContent = title.badge || title.main;
      tab.ariaLabel = `${title.badge || title.main}の時刻表`;
      tab.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        timetableRenderSignature = "";
        showTrainDetails(train.service_uid);
      });
      return tab;
    });
    elements.coupledTabs.replaceChildren(...tabs);
    elements.coupledTabs.hidden = false;
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
        appendDisplayTime(scheduledTime, scheduled);
        if (adjusted) {
          scheduledTime.className = "train-timetable-scheduled-replaced";
          const adjustedTime = document.createElement("strong");
          adjustedTime.className = "train-timetable-adjusted";
          const arrow = document.createElement("span");
          arrow.className = "train-timetable-delay-arrow";
          arrow.textContent = "→";
          appendDisplayTime(adjustedTime, adjusted);
          time.append(scheduledTime, arrow, adjustedTime);
        } else {
          time.append(scheduledTime);
        }
        timeList.append(time);
        if (index < times.length - 1) {
          const separator = document.createElement("span");
          separator.className = "train-timetable-time-separator";
          separator.setAttribute("aria-hidden", "true");
          timeList.append(separator);
        }
      }
      item.append(station, timeList);
      return item;
    });
    elements.stops.replaceChildren(...items);
    currentItem?.scrollIntoView({ block: "center" });
  };

  const showTrainDetails = (serviceUid: string) => {
    const timetableTrain = trainsByServiceUid.get(serviceUid);
    if (!timetableTrain) {
      return;
    }
    const detailTrains = detailTrainsFor(serviceUid);
    const train =
      linkKindByServiceUid.get(serviceUid) === "same-operation"
        ? mergeSameOperationTrains(detailTrains, effectiveTrain(timetableTrain))
        : effectiveTrain(timetableTrain);
    const title = trainTitleFor(train);
    const badge = document.createElement("span");
    badge.className = "train-service-badge";
    badge.textContent = title.badge;
    const mainTitle = document.createElement("span");
    mainTitle.className = "train-title-main";
    mainTitle.textContent = title.main;
    const titleChildren: HTMLElement[] = [badge, mainTitle];
    if (destinationChangedServiceUids.has(serviceUid)) {
      const destinationChange = document.createElement("span");
      destinationChange.className = "train-destination-change";
      const scheduledDestination = document.createElement("span");
      scheduledDestination.className = "train-destination-scheduled";
      scheduledDestination.textContent = timetableTrain.destination_station;
      const arrow = document.createElement("span");
      arrow.className = "train-destination-change-arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");
      const currentDestination = document.createElement("strong");
      currentDestination.className = "train-destination-current";
      currentDestination.textContent = train.destination_station;
      destinationChange.append(
        scheduledDestination,
        arrow,
        currentDestination,
      );
      if (title.suffix) {
        mainTitle.replaceChildren(destinationChange);
      } else {
        titleChildren.push(destinationChange);
      }
    }
    elements.title.replaceChildren(...titleChildren);
    const lineColor = colorsByServiceUid.get(train.service_uid) ?? "#a8aaad";
    elements.title.style.setProperty("--train-line-color", lineColor);
    elements.details.style.setProperty("--train-line-color", lineColor);
    const operation = operationsByTrainNumber?.get(train.train_no);
    const delay = operation?.delayMinutes;
    elements.stopping.hidden = operation?.longTimeStopping !== true;
    elements.delay.hidden = delay === undefined || delay <= 0;
    elements.delay.textContent = delay !== undefined && delay > 0 ? `遅延 ${delay}分` : "";
    showSheet(elements.details);
    renderTrainTimetable(
      train,
      displayedPositions.find(({ serviceUid: id }) => id === serviceUid),
      delay,
    );
    focusSession.start(train.service_uid);
    trainLayer.setFocusedServiceUid(train.service_uid);
    renderCoupledTrainTabs(train.service_uid);
    elements.onFocus?.(train.service_uid);
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
  return {
    focusTrain(serviceUid) {
      const position = displayedPositions.find(
        (candidate) => candidate.serviceUid === serviceUid,
      );
      if (!position || !trainsByServiceUid.has(serviceUid)) {
        return false;
      }
      showTrainDetails(serviceUid);
      const padding = trainFocusPadding(
        window.innerWidth,
        window.innerHeight,
        elements.details.getBoundingClientRect().height,
      );
      map.easeTo({
        center: position.coordinate,
        zoom: Math.max(map.getZoom(), 14),
        duration: 750,
        padding,
        retainPadding: false,
      });
      return true;
    },
    updateTracking(positions) {
      const layouts = coupledTrainLayouts(positions, formationLinks);
      displayedPositions = layouts.map(({ position }) => position);
      coupledServiceUidByServiceUid.clear();
      linkKindByServiceUid.clear();
      for (const {
        position,
        coupledServiceUid,
        linkKind,
      } of layouts) {
        if (coupledServiceUid) {
          coupledServiceUidByServiceUid.set(position.serviceUid, coupledServiceUid);
        }
        if (linkKind) {
          linkKindByServiceUid.set(position.serviceUid, linkKind);
        }
      }
      const focusedServiceUid = focusSession.serviceUid;
      if (!focusedServiceUid) {
        return;
      }
      const position = displayedPositions.find(
        ({ serviceUid }) => serviceUid === focusedServiceUid,
      );
      if (!position) {
        endFocus();
        return;
      }
      showSheet(elements.details);
      const timetableTrain = trainsByServiceUid.get(focusedServiceUid);
      if (timetableTrain) {
        const effective = effectiveTrain(timetableTrain);
        const train =
          linkKindByServiceUid.get(focusedServiceUid) === "same-operation"
            ? mergeSameOperationTrains(
                detailTrainsFor(focusedServiceUid),
                effective,
              )
            : effective;
        renderTrainTimetable(
          train,
          position,
          operationsByTrainNumber?.get(train.train_no)?.delayMinutes,
        );
      }
      renderCoupledTrainTabs(focusedServiceUid);
      map.jumpTo({
        center: position.coordinate,
        padding: trainFocusPadding(
          window.innerWidth,
          window.innerHeight,
          elements.details.getBoundingClientRect().height,
        ),
        retainPadding: false,
      });
    },
    updateOperations(operations, changedServiceUids = new Set()) {
      operationsByTrainNumber = operations;
      destinationChangedServiceUids = changedServiceUids;
      timetableRenderSignature = "";
      const focusedServiceUid = focusSession.serviceUid;
      if (focusedServiceUid) {
        showTrainDetails(focusedServiceUid);
      }
    },
  };
}

export function trainFocusPadding(
  viewportWidth: number,
  viewportHeight: number,
  sheetHeight: number,
): { top: number; right: number; bottom: number; left: number } {
  return {
    top: 0,
    right: 0,
    bottom:
      viewportWidth <= 720
        ? Math.max(0, Math.min(sheetHeight, viewportHeight * 0.72))
        : 0,
    left: 0,
  };
}

function appendDisplayTime(container: HTMLElement, value: string): void {
  const { clock, event } = timetableDisplayTimeParts(value);
  const clockElement = document.createElement("span");
  clockElement.className = "train-timetable-clock";
  clockElement.textContent = clock;
  container.append(clockElement);
  if (event) {
    const eventElement = document.createElement("small");
    eventElement.className = "train-timetable-event";
    eventElement.textContent = event;
    container.append(eventElement);
  }
}
