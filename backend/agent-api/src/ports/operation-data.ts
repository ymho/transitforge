import type { JsonObject } from "../contracts/agent-request.js";

export interface OperationSummaryItem {
  collectedAt?: string;
  sourceUpdatedAt?: string;
  totalCongestion?: number;
  trainCount?: number;
  carCount?: number;
  trainTotals?: Record<string, number>;
  sourceCount?: number;
  failureCount?: number;
  observedTrainCount?: number;
  delayedTrainCount?: number;
  totalDelayMinutes?: number;
  maximumDelayMinutes?: number;
  trainDelays?: Record<string, number>;
}

export interface OperationSummaryRepository {
  findByServiceDate(table: string, serviceDate: string): Promise<OperationSummaryItem[]>;
}

export type RepresentativeTimetableKind = "weekday" | "weekend_holiday";

export interface RepresentativeTimetableRepository {
  load(kind: RepresentativeTimetableKind): Promise<JsonObject>;
}
