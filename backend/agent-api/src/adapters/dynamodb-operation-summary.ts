import type { JsonObject } from "../contracts/agent-request.js";
import type {
  OperationSummaryItem,
  OperationSummaryRepository,
} from "../ports/operation-data.js";

export interface DynamoDbQueryClient {
  query(input: JsonObject): Promise<unknown>;
}

export class DynamoDbOperationSummaryRepository implements OperationSummaryRepository {
  constructor(private readonly client: DynamoDbQueryClient) {}

  async findByServiceDate(table: string, serviceDate: string): Promise<OperationSummaryItem[]> {
    const items: OperationSummaryItem[] = [];
    let exclusiveStartKey: unknown;
    do {
      const result = await this.client.query({
        TableName: table,
        KeyConditionExpression: "serviceDate = :service_date",
        ExpressionAttributeValues: { ":service_date": { S: serviceDate } },
        ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
      });
      if (!isRecord(result)) throw new Error("DynamoDB query response is invalid");
      if (Array.isArray(result.Items)) {
        items.push(...result.Items.filter(isRecord).map(decodedItem));
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey !== undefined && exclusiveStartKey !== null);
    return items;
  }
}

function decodedItem(value: JsonObject): OperationSummaryItem {
  return {
    collectedAt: stringAttribute(value.collectedAt),
    sourceUpdatedAt: stringAttribute(value.sourceUpdatedAt),
    totalCongestion: numberAttribute(value.totalCongestion),
    trainCount: numberAttribute(value.trainCount),
    carCount: numberAttribute(value.carCount),
    trainTotals: numberMapAttribute(value.trainTotals),
    sourceCount: numberAttribute(value.sourceCount),
    failureCount: numberAttribute(value.failureCount),
    observedTrainCount: numberAttribute(value.observedTrainCount),
    delayedTrainCount: numberAttribute(value.delayedTrainCount),
    totalDelayMinutes: numberAttribute(value.totalDelayMinutes),
    maximumDelayMinutes: numberAttribute(value.maximumDelayMinutes),
    trainDelays: numberMapAttribute(value.trainDelays),
  };
}

function stringAttribute(value: unknown): string | undefined {
  return isRecord(value) && typeof value.S === "string" ? value.S : undefined;
}

function numberAttribute(value: unknown): number {
  if (!isRecord(value) || typeof value.N !== "string") return 0;
  const parsed = Number(value.N);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberMapAttribute(value: unknown): Record<string, number> {
  if (!isRecord(value) || !isRecord(value.M)) return {};
  return Object.fromEntries(Object.entries(value.M).map(([key, item]) => [key, numberAttribute(item)]));
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
