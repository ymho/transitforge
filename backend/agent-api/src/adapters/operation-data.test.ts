import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { DynamoDbOperationSummaryRepository } from "./dynamodb-operation-summary.js";
import { S3RepresentativeTimetableRepository } from "./s3-representative-timetable.js";

describe("operation data adapters", () => {
  it("paginates DynamoDB and decodes only the provider format", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ Items: [{ collectedAt: { S: "2026-07-29T00:00:00Z" }, totalCongestion: { N: "12.5" }, trainTotals: { M: { "100A": { N: "8" } } } }], LastEvaluatedKey: { serviceDate: { S: "next" } } })
      .mockResolvedValueOnce({ Items: [] });
    const repository = new DynamoDbOperationSummaryRepository({ query });
    expect(await repository.findByServiceDate("summary", "2026-07-29")).toEqual([{ collectedAt: "2026-07-29T00:00:00Z", sourceUpdatedAt: undefined, totalCongestion: 12.5, trainCount: 0, carCount: 0, trainTotals: { "100A": 8 }, sourceCount: 0, failureCount: 0, observedTrainCount: 0, delayedTrainCount: 0, totalDelayMinutes: 0, maximumDelayMinutes: 0, trainDelays: {} }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("loads validates and caches a gzipped representative timetable by ETag", async () => {
    const value = { schema_version: "ai-timetable-v1", service_date: "2026-07-31", trains: [] };
    const headObject = vi.fn(async () => ({ ETag: "v1" }));
    const getObject = vi.fn(async () => ({ Body: gzipSync(JSON.stringify(value)) }));
    const repository = new S3RepresentativeTimetableRepository({ headObject, getObject }, "bucket", "/ai-timetable/");
    expect(await repository.load("weekday")).toEqual(value);
    expect(await repository.load("weekday")).toEqual(value);
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(headObject).toHaveBeenCalledWith({ Bucket: "bucket", Key: "ai-timetable/weekday.json.gz" });
  });
});
