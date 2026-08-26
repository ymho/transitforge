export interface TrainOperation {
  delayMinutes: number;
  destination: string;
  sources: readonly string[];
  longTimeStopping?: boolean;
}

export interface TrainDelaySnapshot {
  collectedAt: string;
  failedSources: string[];
  operationsByTrainNumber: ReadonlyMap<string, TrainOperation>;
}

export interface TrainCongestionSnapshot {
  updatedAt: string;
  byTrainNumber: ReadonlyMap<string, number>;
}
