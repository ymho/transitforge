import {
  isStationLineCatalog,
} from "./station-line-catalog";
import type { Train, TrainIndex, TrainStop } from "../../../domain/rail/train";

export type { Train, TrainIndex, TrainStop } from "../../../domain/rail/train";

export async function loadTrainIndex(): Promise<TrainIndex> {
  const response = await fetch("/viewer-input/train_index.json");

  if (!response.ok) {
    throw new Error(`列車インデックスを読み込めませんでした (${response.status})。`);
  }

  const index: unknown = await response.json();

  if (!isTrainIndex(index)) {
    throw new Error("列車インデックスの形式またはスキーマバージョンが不正です。");
  }

  return index;
}

function isTrainIndex(value: unknown): value is TrainIndex {
  return (
    isRecord(value) &&
    value.schema_version === "train-index-v1" &&
    typeof value.path_catalog === "string" &&
    (value.service_date === undefined ||
      (typeof value.service_date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.service_date))) &&
    (value.timetable_kind === undefined ||
      value.timetable_kind === "weekday" ||
      value.timetable_kind === "weekend_holiday") &&
    (value.station_line_catalog === undefined ||
      isStationLineCatalog(value.station_line_catalog)) &&
    Array.isArray(value.trains) &&
    value.trains.every(isTrain)
  );
}

function isTrain(value: unknown): value is Train {
  return (
    isRecord(value) &&
    typeof value.service_uid === "string" &&
    typeof value.train_no === "string" &&
    typeof value.service_type === "string" &&
    typeof value.train_name === "string" &&
    typeof value.origin_station === "string" &&
    typeof value.destination_station === "string" &&
    (value.path_id === undefined || typeof value.path_id === "string") &&
    Array.isArray(value.stops) &&
    value.stops.every(isTrainStop)
  );
}

function isTrainStop(value: unknown): value is TrainStop {
  return (
    isRecord(value) &&
    (value.station_name === undefined || typeof value.station_name === "string") &&
    (value.event === undefined || typeof value.event === "string") &&
    (value.time === undefined || typeof value.time === "string") &&
    (value.normalized_time === undefined || typeof value.normalized_time === "string") &&
    (value.route_meter === undefined || isFiniteNumber(value.route_meter)) &&
    (value.route_time_minutes === undefined || isFiniteNumber(value.route_time_minutes))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
