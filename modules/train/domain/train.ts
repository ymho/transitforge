import type { StationLineCatalog } from "./station";

export interface TrainStop {
  station_name?: string;
  event?: string;
  time?: string;
  normalized_time?: string;
  route_meter?: number;
  route_time_minutes?: number;
}

export interface Train {
  service_uid: string;
  train_no: string;
  service_type: string;
  train_name: string;
  origin_station: string;
  destination_station: string;
  path_id?: string;
  stops: TrainStop[];
}

export interface TrainIndex {
  schema_version: "train-index-v1";
  path_catalog: string;
  service_date?: string;
  timetable_kind?: "weekday" | "weekend_holiday";
  station_line_catalog?: StationLineCatalog;
  trains: Train[];
}
