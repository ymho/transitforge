import { expect, it } from "vitest";
import { inTripToolCases, runInTripToolScenario } from "./in-trip-tool-scenarios.fixture";
it.each(Object.keys(inTripToolCases))("additional evidence can still be acquired: %s", async (id) => {
  const report = await runInTripToolScenario({ id, name: id, userRequest: "最新情報を検索して", tags: [], thresholds: { selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 0 } });
  expect(report.contractFailures).toEqual([]);
  expect(report.toolCalls).toBeGreaterThan(0);
});
