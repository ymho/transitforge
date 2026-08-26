import {
  analyzeCongestion,
  analyzeDelay,
  isInOperatingDay,
  isValidServiceDate,
  nextServiceDate,
  type CongestionObservation,
  type DelayObservation,
} from "@raiquora/operation";

import { type JsonObject, RequestError } from "../contracts/agent-request.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { OperationSummaryItem, OperationSummaryRepository } from "../ports/operation-data.js";

export function createCongestionAnalysisOperation(repository: OperationSummaryRepository, table: string): AgentOperation {
  return async (request) => {
    const serviceDate = validatedServiceDate(request.serviceDate);
    const items = await operatingDayItems(repository, table, serviceDate);
    return { body: analyzeCongestion(serviceDate, items.flatMap(congestionObservation)) as unknown as JsonObject };
  };
}

export function createCongestionPeakOperation(repository: OperationSummaryRepository, table: string): AgentOperation {
  return async (request) => {
    const result = await createCongestionAnalysisOperation(repository, table)(request, { requestId: "internal" });
    return { body: { serviceDate: result.body.serviceDate, sampleCount: result.body.sampleCount, peak: result.body.peak } };
  };
}

export function createDelayAnalysisOperation(repository: OperationSummaryRepository, table: string): AgentOperation {
  return async (request) => {
    const serviceDate = validatedServiceDate(request.serviceDate);
    const items = await operatingDayItems(repository, table, serviceDate);
    return { body: analyzeDelay(serviceDate, items.flatMap(delayObservation)) as unknown as JsonObject };
  };
}

async function operatingDayItems(repository: OperationSummaryRepository, table: string, serviceDate: string): Promise<OperationSummaryItem[]> {
  const items = await Promise.all([
    repository.findByServiceDate(table, serviceDate),
    repository.findByServiceDate(table, nextServiceDate(serviceDate)),
  ]);
  return items.flat().filter((item) => typeof item.collectedAt === "string" && isInOperatingDay(item.collectedAt, serviceDate));
}

function congestionObservation(item: OperationSummaryItem): CongestionObservation[] {
  return typeof item.collectedAt === "string" && typeof item.sourceUpdatedAt === "string"
    ? [{ collectedAt: item.collectedAt, sourceUpdatedAt: item.sourceUpdatedAt, totalCongestion: item.totalCongestion ?? 0, trainCount: item.trainCount ?? 0, carCount: item.carCount ?? 0, trainTotals: item.trainTotals ?? {} }]
    : [];
}

function delayObservation(item: OperationSummaryItem): DelayObservation[] {
  return typeof item.collectedAt === "string"
    ? [{ collectedAt: item.collectedAt, sourceCount: item.sourceCount ?? 0, failureCount: item.failureCount ?? 0, observedTrainCount: item.observedTrainCount ?? 0, delayedTrainCount: item.delayedTrainCount ?? 0, totalDelayMinutes: item.totalDelayMinutes ?? 0, maximumDelayMinutes: item.maximumDelayMinutes ?? 0, trainDelays: item.trainDelays ?? {} }]
    : [];
}

function validatedServiceDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new RequestError(400, "serviceDateはYYYY-MM-DD形式にしてください。");
  if (!isValidServiceDate(value)) throw new RequestError(400, "serviceDateが実在する日付ではありません。");
  return value;
}
