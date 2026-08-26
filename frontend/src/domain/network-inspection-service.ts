import type { StationCoordinate, StationLineCatalog } from "@raiquora/train/station";
import type { Train, TrainIndex } from "@raiquora/train/train";
import { normalizeStationName } from "@raiquora/train/station-name";
import { TrainLineColorIndex } from "./train-line-color";

export type NetworkInspectionErrorCode =
  | "not_found"
  | "ambiguous_entity"
  | "invalid_range";

export type NetworkInspectionResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: NetworkInspectionErrorCode; message: string };
    };

export interface TrainInspection {
  serviceUid: string;
  trainNumber: string;
  serviceType: string;
  trainName: string;
  originStation: string;
  destinationStation: string;
  lineName: string;
  pathId?: string;
  timetableStopCount: number;
  firstTimeMinutes?: number;
  lastTimeMinutes?: number;
  serviceDate?: string;
  timetableKind?: "weekday" | "weekend_holiday";
  source: "timetable";
}

export interface StationInspection {
  stationName: string;
  normalizedStationName: string;
  coordinates: StationCoordinate[];
  coordinateCount: number;
  lines: Array<{ operator: string; lineName: string }>;
  totalLineCount: number;
  returnedLineCount: number;
  timetableServiceCount: number;
  serviceTypes: string[];
  serviceTypeCount: number;
  serviceDate?: string;
  timetableKind?: "weekday" | "weekend_holiday";
  catalogSource?: string;
  source: "station-line-catalog" | "timetable";
}

export interface RouteDetailStop {
  stationName: string;
  event?: string;
  routeTimeMinutes?: number;
}

export interface RouteDetails {
  train: TrainInspection;
  segmentOriginStation: string;
  segmentDestinationStation: string;
  totalStopRecordCount: number;
  offset: number;
  returnedStopRecordCount: number;
  hasMore: boolean;
  stops: RouteDetailStop[];
}

export interface RouteDetailsRequest {
  serviceUid: string;
  originStation?: string;
  destinationStation?: string;
  offset?: number;
  limit?: number;
}

interface StationRecord {
  names: Set<string>;
  coordinates: StationCoordinate[];
  lines: Map<string, { operator: string; lineName: string }>;
}

export const maximumRouteDetailStops = 20;
export const maximumStationLines = 12;
export const maximumStationServiceTypes = 12;

export class NetworkInspectionService {
  private readonly trainsByServiceUid = new Map<string, Train[]>();
  private readonly stations = new Map<string, StationRecord>();
  private readonly lineColors: TrainLineColorIndex;

  constructor(
    private readonly trainIndex: TrainIndex,
    private readonly stationCatalog: StationLineCatalog = trainIndex.station_line_catalog ?? {
      schema_version: "station-line-catalog-v1",
      source: "unavailable",
      lines: [],
    },
  ) {
    this.lineColors = new TrainLineColorIndex(stationCatalog);
    for (const train of trainIndex.trains) {
      const services = this.trainsByServiceUid.get(train.service_uid) ?? [];
      services.push(train);
      this.trainsByServiceUid.set(train.service_uid, services);
      for (const name of [
        train.origin_station,
        train.destination_station,
        ...train.stops.flatMap((stop) => stop.station_name ? [stop.station_name] : []),
      ]) {
        this.stationRecord(name).names.add(name);
      }
    }
    for (const line of stationCatalog.lines) {
      for (const station of line.stations) {
        const record = this.stationRecord(station.name);
        record.names.add(station.name);
        if (!record.coordinates.some(([longitude, latitude]) =>
          longitude === station.coordinate[0] && latitude === station.coordinate[1])) {
          record.coordinates.push(station.coordinate);
        }
        record.lines.set(`${line.operator}\u0000${line.line}`, {
          operator: line.operator,
          lineName: line.line,
        });
      }
    }
  }

  inspectTrain(serviceUid: string): NetworkInspectionResult<TrainInspection> {
    const resolved = this.resolveTrain(serviceUid);
    return resolved.ok ? { ok: true, value: this.trainInspection(resolved.value) } : resolved;
  }

  inspectStation(stationName: string): NetworkInspectionResult<StationInspection> {
    const normalized = normalizeStationName(stationName);
    const record = this.stations.get(normalized);
    if (!record) {
      const prefixMatches = [...this.stations.keys()].filter((name) =>
        name.startsWith(normalized) || normalized.startsWith(name));
      return {
        ok: false,
        error: prefixMatches.length > 1
          ? { code: "ambiguous_entity", message: `駅名「${stationName}」を一意に特定できません` }
          : { code: "not_found", message: `駅名「${stationName}」は見つかりません` },
      };
    }

    const servingTrains = this.trainIndex.trains.filter((train) => [
      train.origin_station,
      train.destination_station,
      ...train.stops.flatMap((stop) => stop.station_name ? [stop.station_name] : []),
    ].some((name) => normalizeStationName(name) === normalized));
    const stationLabel = [...record.names]
      .sort((left, right) => left.length - right.length || left.localeCompare(right, "ja"))[0]
      ?? stationName;
    const allLines = [...record.lines.values()]
      .sort((left, right) =>
        left.operator.localeCompare(right.operator, "ja") ||
        left.lineName.localeCompare(right.lineName, "ja"));
    const lines = allLines.slice(0, maximumStationLines);
    const serviceTypes = [...new Set(servingTrains.map((train) => train.service_type))]
      .sort((left, right) => left.localeCompare(right, "ja"));
    return {
      ok: true,
      value: {
        stationName: stationLabel,
        normalizedStationName: normalized,
        coordinates: record.coordinates.slice(0, 4),
        coordinateCount: record.coordinates.length,
        lines,
        totalLineCount: allLines.length,
        returnedLineCount: lines.length,
        timetableServiceCount: servingTrains.length,
        serviceTypes: serviceTypes.slice(0, maximumStationServiceTypes),
        serviceTypeCount: serviceTypes.length,
        ...(this.trainIndex.service_date === undefined
          ? {}
          : { serviceDate: this.trainIndex.service_date }),
        ...(this.trainIndex.timetable_kind === undefined
          ? {}
          : { timetableKind: this.trainIndex.timetable_kind }),
        ...(record.lines.size === 0
          ? {}
          : { catalogSource: this.stationCatalog.source }),
        source: record.lines.size > 0 ? "station-line-catalog" : "timetable",
      },
    };
  }

  getRouteDetails(
    request: RouteDetailsRequest,
  ): NetworkInspectionResult<RouteDetails> {
    const resolved = this.resolveTrain(request.serviceUid);
    if (!resolved.ok) return resolved;
    const train = resolved.value;
    const namedStops = train.stops.filter(
      (stop): stop is typeof stop & { station_name: string } =>
        typeof stop.station_name === "string" && stop.station_name.length > 0,
    );
    const originIndex = request.originStation === undefined
      ? 0
      : namedStops.findIndex((stop) =>
          normalizeStationName(stop.station_name) ===
          normalizeStationName(request.originStation ?? ""));
    const destinationIndex = request.destinationStation === undefined
      ? namedStops.length - 1
      : namedStops.findIndex((stop, index) =>
          index >= Math.max(originIndex, 0) &&
          normalizeStationName(stop.station_name) ===
          normalizeStationName(request.destinationStation ?? ""));
    if (
      originIndex >= 0 &&
      destinationIndex < 0 &&
      request.destinationStation !== undefined &&
      namedStops.slice(0, originIndex).some((stop) =>
        normalizeStationName(stop.station_name) ===
        normalizeStationName(request.destinationStation ?? ""))
    ) {
      return {
        ok: false,
        error: { code: "invalid_range", message: "到着駅が出発駅より前にあります" },
      };
    }
    if (originIndex < 0 || destinationIndex < 0) {
      const missing = originIndex < 0 ? request.originStation : request.destinationStation;
      return {
        ok: false,
        error: { code: "not_found", message: `列車内に駅名「${missing}」は見つかりません` },
      };
    }
    const segment = namedStops.slice(originIndex, destinationIndex + 1);
    const offset = request.offset ?? 0;
    const limit = request.limit ?? maximumRouteDetailStops;
    if (
      !Number.isInteger(offset) || offset < 0 ||
      !Number.isInteger(limit) || limit < 1 || limit > maximumRouteDetailStops
    ) {
      return {
        ok: false,
        error: { code: "invalid_range", message: "停車駅の取得範囲が不正です" },
      };
    }
    const page = segment.slice(offset, offset + limit).map((stop) => ({
      stationName: stop.station_name,
      ...(stop.event === undefined ? {} : { event: stop.event }),
      ...(stop.route_time_minutes === undefined
        ? {}
        : { routeTimeMinutes: stop.route_time_minutes }),
    }));
    return {
      ok: true,
      value: {
        train: this.trainInspection(train),
        segmentOriginStation: segment[0]?.station_name ?? train.origin_station,
        segmentDestinationStation:
          segment.at(-1)?.station_name ?? train.destination_station,
        totalStopRecordCount: segment.length,
        offset,
        returnedStopRecordCount: page.length,
        hasMore: offset + page.length < segment.length,
        stops: page,
      },
    };
  }

  private resolveTrain(serviceUid: string): NetworkInspectionResult<Train> {
    const trains = this.trainsByServiceUid.get(serviceUid) ?? [];
    if (trains.length === 0) {
      return {
        ok: false,
        error: { code: "not_found", message: `serviceUid「${serviceUid}」は見つかりません` },
      };
    }
    if (trains.length > 1) {
      return {
        ok: false,
        error: { code: "ambiguous_entity", message: `serviceUid「${serviceUid}」が重複しています` },
      };
    }
    return { ok: true, value: trains[0] };
  }

  private trainInspection(train: Train): TrainInspection {
    const routeTimes = train.stops.flatMap((stop) =>
      stop.route_time_minutes === undefined ? [] : [stop.route_time_minutes]);
    const line = this.lineColors.colorFor(train);
    return {
      serviceUid: train.service_uid,
      trainNumber: train.train_no,
      serviceType: train.service_type,
      trainName: train.train_name,
      originStation: train.origin_station,
      destinationStation: train.destination_station,
      lineName: line.lineName,
      ...(train.path_id === undefined ? {} : { pathId: train.path_id }),
      timetableStopCount: train.stops.filter((stop) => stop.station_name).length,
      ...(routeTimes[0] === undefined ? {} : { firstTimeMinutes: routeTimes[0] }),
      ...(routeTimes.at(-1) === undefined ? {} : { lastTimeMinutes: routeTimes.at(-1) }),
      ...(this.trainIndex.service_date === undefined
        ? {}
        : { serviceDate: this.trainIndex.service_date }),
      ...(this.trainIndex.timetable_kind === undefined
        ? {}
        : { timetableKind: this.trainIndex.timetable_kind }),
      source: "timetable",
    };
  }

  private stationRecord(stationName: string): StationRecord {
    const normalized = normalizeStationName(stationName);
    const existing = this.stations.get(normalized);
    if (existing) return existing;
    const created: StationRecord = {
      names: new Set(),
      coordinates: [],
      lines: new Map(),
    };
    this.stations.set(normalized, created);
    return created;
  }
}
