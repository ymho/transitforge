import type { TrainOperation, TrainDelaySnapshot } from "../data/train-delay";
import type { Train, TrainStop } from "../data/train-index";
import { normalizeStationName } from "./direct-route-search";

export const realtimeSnapshotToleranceMilliseconds = 5 * 60 * 1_000;

export function operationsForDisplay(
  snapshot: TrainDelaySnapshot | undefined,
  displayedAt: Date,
  now: Date,
  timetableRequested: boolean,
): ReadonlyMap<string, TrainOperation> | undefined {
  if (
    timetableRequested ||
    snapshot === undefined ||
    snapshot.failedSources.length > 0
  ) {
    return undefined;
  }
  const collectedAt = new Date(snapshot.collectedAt);
  if (
    Math.abs(now.getTime() - collectedAt.getTime()) >
      realtimeSnapshotToleranceMilliseconds ||
    Math.abs(displayedAt.getTime() - collectedAt.getTime()) >
      realtimeSnapshotToleranceMilliseconds
  ) {
    return undefined;
  }
  return snapshot.operationsByTrainNumber;
}

export function trainsForOperations(
  timetableTrains: Train[],
  operations: ReadonlyMap<string, TrainOperation> | undefined,
  destinationChangedServiceUids: ReadonlySet<string> = new Set(),
): Train[] {
  if (operations === undefined) {
    return timetableTrains;
  }
  return timetableTrains.flatMap((train) => {
    const operation = operations.get(train.train_no);
    return operation
      ? [
          trainWithOperation(
            train,
            operation,
            destinationChangedServiceUids.has(train.service_uid),
          ),
        ]
      : [];
  });
}

export function trainWithOperation(
  train: Train,
  operation: TrainOperation,
  destinationChanged = false,
): Train {
  const destination = operation.destination || train.destination_station;
  if (
    normalizeStationName(destination) ===
    normalizeStationName(train.destination_station)
  ) {
    return train;
  }
  return {
    ...train,
    destination_station: destination,
    stops: destinationChanged
      ? stopsThroughDestination(train.stops, destination)
      : train.stops,
  };
}

export function delayByTrainNumber(
  operations: ReadonlyMap<string, TrainOperation> | undefined,
): ReadonlyMap<string, number> {
  return new Map(
    [...(operations ?? [])].map(([trainNumber, operation]) => [
      trainNumber,
      operation.delayMinutes,
    ]),
  );
}

export function destinationChangedServiceUids(
  timetableTrains: Train[],
  operations: ReadonlyMap<string, TrainOperation> | undefined,
): ReadonlySet<string> {
  if (operations === undefined) {
    return new Set();
  }
  return new Set(
    timetableTrains.flatMap((train) => {
      const operation = operations.get(train.train_no);
      const destination = operation?.destination;
      return destination &&
        !operation.sources.includes("osakaloop") &&
        normalizeStationName(destination) !==
          normalizeStationName(train.destination_station) &&
        isIntermediateStop(train.stops, destination)
        ? [train.service_uid]
        : [];
    }),
  );
}

function isIntermediateStop(stops: TrainStop[], destination: string): boolean {
  const normalizedDestination = normalizeStationName(destination);
  const stationNames = stops.flatMap((stop) =>
    typeof stop.station_name === "string"
      ? [normalizeStationName(stop.station_name)]
      : [],
  );
  return stationNames
    .slice(1, -1)
    .some((stationName) => stationName === normalizedDestination);
}

function stopsThroughDestination(
  stops: TrainStop[],
  destination: string,
): TrainStop[] {
  const normalizedDestination = normalizeStationName(destination);
  const firstDestinationIndex = stops.findIndex(
    (stop) =>
      typeof stop.station_name === "string" &&
      normalizeStationName(stop.station_name) === normalizedDestination,
  );
  if (firstDestinationIndex < 0) {
    return stops;
  }
  let lastDestinationIndex = firstDestinationIndex;
  while (
    lastDestinationIndex + 1 < stops.length &&
    typeof stops[lastDestinationIndex + 1]?.station_name === "string" &&
    normalizeStationName(stops[lastDestinationIndex + 1].station_name ?? "") ===
      normalizedDestination
  ) {
    lastDestinationIndex += 1;
  }
  return stops.slice(0, lastDestinationIndex + 1);
}
