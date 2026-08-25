import type { TrainOperation, TrainDelaySnapshot } from "../data/train-delay";
import type { Train, TrainStop } from "../data/train-index";
import { normalizeStationName } from "./station-name";
import type { TrainFormationLink } from "./train-formation-link";

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

export function operationsWithTimetableTrainNumberAliases(
  timetableTrains: Train[],
  operations: ReadonlyMap<string, TrainOperation> | undefined,
): ReadonlyMap<string, TrainOperation> | undefined {
  if (operations === undefined) {
    return undefined;
  }
  const resolved = new Map(operations);
  for (const train of timetableTrains) {
    if (resolved.has(train.train_no)) {
      continue;
    }
    const alias = realtimeTrainNumberAlias(train);
    const operation = alias ? operations.get(alias) : undefined;
    if (operation && !operation.sources.includes("osakaloop")) {
      continue;
    }
    if (operation) {
      resolved.set(train.train_no, operation);
    }
  }
  return resolved;
}

export function operationsWithCoupledTrainOperations(
  timetableTrains: Train[],
  operations: ReadonlyMap<string, TrainOperation> | undefined,
  formationLinks: ReadonlyMap<string, TrainFormationLink>,
): ReadonlyMap<string, TrainOperation> | undefined {
  if (operations === undefined) {
    return undefined;
  }
  const resolved = new Map(operations);
  const trainsByServiceUid = new Map(
    timetableTrains.map((train) => [train.service_uid, train]),
  );
  const processedPairs = new Set<string>();

  for (const [serviceUid, link] of formationLinks) {
    if (link.linkKind !== "coupled-service") {
      continue;
    }
    const pairKey = [serviceUid, link.partnerServiceUid].sort().join("\t");
    if (processedPairs.has(pairKey)) {
      continue;
    }
    processedPairs.add(pairKey);

    const left = trainsByServiceUid.get(serviceUid);
    const right = trainsByServiceUid.get(link.partnerServiceUid);
    if (!left || !right) {
      continue;
    }
    const leftOperation = resolved.get(left.train_no);
    const rightOperation = resolved.get(right.train_no);
    if (!leftOperation && !rightOperation) {
      continue;
    }

    const availableOperations = [leftOperation, rightOperation].filter(
      (operation): operation is TrainOperation => operation !== undefined,
    );
    const delayMinutes = Math.max(
      ...availableOperations.map((operation) => operation.delayMinutes),
    );
    const sources = [
      ...new Set(availableOperations.flatMap((operation) => operation.sources)),
    ];
    const longTimeStopping = availableOperations.some(
      (operation) => operation.longTimeStopping === true,
    );
    const changedDestination = sharedChangedDestination(
      left,
      right,
      leftOperation,
      rightOperation,
    );
    const effectiveSources = changedDestination
      ? sources.filter((source) => source !== "osakaloop")
      : sources;

    resolved.set(left.train_no, {
      delayMinutes,
      destination:
        changedDestination ??
        leftOperation?.destination ??
        left.destination_station,
      sources: effectiveSources,
      longTimeStopping,
    });
    resolved.set(right.train_no, {
      delayMinutes,
      destination:
        changedDestination ??
        rightOperation?.destination ??
        right.destination_station,
      sources: effectiveSources,
      longTimeStopping,
    });
  }
  return resolved;
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
      return operationChangesDestination(train, operation)
        ? [train.service_uid]
        : [];
    }),
  );
}

function sharedChangedDestination(
  left: Train,
  right: Train,
  leftOperation: TrainOperation | undefined,
  rightOperation: TrainOperation | undefined,
): string | undefined {
  const candidates = [
    { train: left, operation: leftOperation },
    { train: right, operation: rightOperation },
  ]
    .filter(
      (candidate): candidate is { train: Train; operation: TrainOperation } =>
        operationChangesDestination(candidate.train, candidate.operation),
    )
    .filter(({ operation }) =>
      hasStop(left.stops, operation.destination) &&
      hasStop(right.stops, operation.destination),
    )
    .sort(
      (a, b) =>
        b.operation.delayMinutes - a.operation.delayMinutes ||
        a.operation.destination.localeCompare(b.operation.destination, "ja"),
    );
  return candidates[0]?.operation.destination;
}

function operationChangesDestination(
  train: Train,
  operation: TrainOperation | undefined,
): boolean {
  const destination = operation?.destination;
  return Boolean(
    destination &&
      !operation.sources.includes("osakaloop") &&
      normalizeStationName(destination) !==
        normalizeStationName(train.destination_station) &&
      isIntermediateStop(train.stops, destination),
  );
}

function hasStop(stops: TrainStop[], destination: string): boolean {
  const normalizedDestination = normalizeStationName(destination);
  return stops.some(
    (stop) =>
      typeof stop.station_name === "string" &&
      normalizeStationName(stop.station_name) === normalizedDestination,
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

function realtimeTrainNumberAlias(train: Train): string | undefined {
  if (!train.service_type.includes("関空快速")) {
    return undefined;
  }
  const match = /^(\d+)M$/u.exec(train.train_no);
  return match?.[1];
}
