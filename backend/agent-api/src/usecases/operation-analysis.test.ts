import { describe, expect, it, vi } from "vitest";

import type { OperationSummaryRepository } from "../ports/operation-data.js";
import { createDelayAnalysisOperation } from "./operation-analysis.js";

describe("operation analysis usecase", () => {
  it("queries two partition dates and keeps only the 4am operating day", async () => {
    const findByServiceDate = vi.fn(async (_table: string, date: string) => date === "2026-07-29" ? [
      item("2026-07-28T18:59:59+00:00", "before"),
      item("2026-07-28T19:00:00+00:00", "start"),
    ] : [
      item("2026-07-29T18:59:59+00:00", "end"),
      item("2026-07-29T19:00:00+00:00", "after"),
    ]);
    const operation = createDelayAnalysisOperation({ findByServiceDate } satisfies OperationSummaryRepository, "summaries");
    const result = await operation({ serviceDate: "2026-07-29" }, { requestId: "request-1" });
    expect(result.body.sampleCount).toBe(2);
    expect(findByServiceDate.mock.calls.map(([, date]) => date)).toEqual(["2026-07-29", "2026-07-30"]);
  });
});

function item(collectedAt: string, trainNumber: string) {
  return { collectedAt, sourceCount: 1, failureCount: 0, observedTrainCount: 1, delayedTrainCount: 1, totalDelayMinutes: 2, maximumDelayMinutes: 2, trainDelays: { [trainNumber]: 2 } };
}
