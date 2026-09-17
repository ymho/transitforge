import { expect, it } from "vitest";
import { inTripCaseIds, runInTripProgressScenario } from "./in-trip-progress-scenarios.fixture";
import { modelAnswer } from "./ask-progress-scenarios.fixture";
it.each(["現在、列車で移動中です。", "現在、列車の移動中です。", "現在、屋外で散策しています。"])("does not accept planned state as actual whereabouts: %s", async (text) => {
  const r = await runInTripProgressScenario({ id: "AM-in-trip-location-denied", name: "location boundary", userRequest: "次は？", tags: [],
    thresholds: { selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 0 } }, async () => modelAnswer(`${text}位置情報は許可されていません。`));
  expect(r.contractFailures).toContain("planned state promoted to actual location or boarding");
});
it.each(inTripCaseIds)("production runtime regression %s", async (id) => {
  const r = await runInTripProgressScenario({ id, name: id, userRequest: "この後どうしよう", tags: [],
    thresholds: { selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 0 } });
  expect(r.failures).toEqual([]); expect(r.modelCalls).toBe(1); expect(r.toolCalls).toBe(0);
});
