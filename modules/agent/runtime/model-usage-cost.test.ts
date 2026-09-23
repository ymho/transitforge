import { expect, it } from "vitest";
import { estimateModelUsageCost } from "./model-usage-cost";

it("adds uncached/read/write tokens once and keeps unknown cache pricing explicit", () => {
  expect(estimateModelUsageCost({ inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 200, cacheWriteInputTokens: 300 },
    { pricingVersion: "fixture-v1", inputPerMillionUsd: 1, outputPerMillionUsd: 2, cacheReadPerMillionUsd: .1, cacheWritePerMillionUsd: 1.25 }))
    .toEqual({ pricingVersion: "fixture-v1", totalInputTokens: 600, estimatedCostUsd: .000515, incomplete: false });
  expect(estimateModelUsageCost({ inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 200 },
    { pricingVersion: "fixture-v1", inputPerMillionUsd: 1, outputPerMillionUsd: 2 })).toMatchObject({ totalInputTokens: 300, incomplete: true });
});
