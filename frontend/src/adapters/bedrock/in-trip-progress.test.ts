import { expect, it } from "vitest";
import { inTripCaseIds, runInTripProgressScenario } from "./in-trip-progress-scenarios.fixture";
it.each(inTripCaseIds)("production runtime regression %s", async (id) => {
  const r = await runInTripProgressScenario({ id, name: id, userRequest: "この後どうしよう", tags: [],
    thresholds: { selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 0 } });
  expect(r.failures).toEqual([]); expect(r.modelCalls).toBe(1); expect(r.toolCalls).toBe(0);
});
