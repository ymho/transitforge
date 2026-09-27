import { expect, it } from "vitest";
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import type { PartyScopeCatalog } from "@raiquora/trip/party-cohorts";
import { conditionDelta } from "./conversation-condition";
import { reduceConversationIntent } from "./conversation-intent-reducer";
import { compileEffectiveIntent } from "./effective-intent";
import { publicSemanticReceipt } from "./public-semantic-receipt";
import { conditionDisplayLines } from "./agent-v2-condition-display";

it("joins accepted same-operation receipts to current conditions, deduplicating replay without exposing provenance", () => {
  const overlay = emptyConversationIntentOverlay();
  const change = { target: "origin" as const, place: "大阪", quote: "PRIVATE_QUOTE" };
  const accepted = reduceConversationIntent(overlay, conditionDelta(change, "PRIVATE_TURN", overlay));
  const receipt = publicSemanticReceipt(accepted.receipt), current = compileEffectiveIntent({ overlay: accepted.overlay });
  expect(conditionDisplayLines([receipt, receipt], current)).toEqual(["出発地：大阪"]);
  expect(conditionDisplayLines([], current)).toEqual([]);
  const later = reduceConversationIntent(accepted.overlay, conditionDelta({ ...change, place: "神戸" }, "later", accepted.overlay));
  expect(conditionDisplayLines([receipt], compileEffectiveIntent({ overlay: later.overlay }))).toEqual([]);
  const cleared = reduceConversationIntent(accepted.overlay, conditionDelta({ ...change, place: null }, "clear", accepted.overlay));
  expect(conditionDisplayLines([publicSemanticReceipt(cleared.receipt)], compileEffectiveIntent({ overlay: cleared.overlay }))).toEqual(["出発地：未定"]);
});
it("renders anonymous scopes and independent attributes without prices, inferred ages or internal IDs", () => {
  const catalog: PartyScopeCatalog = { tripId: "PRIVATE_TRIP", tripRevision: 2, days: [{ id: "PRIVATE_DAY_1", label: "1日目" }, { id: "PRIVATE_DAY_2", label: "2日目" }], segments: [] };
  const overlay = emptyConversationIntentOverlay();
  const accepted = reduceConversationIntent(overlay, conditionDelta({ target: "party_details", quote: "PRIVATE_QUOTE", cohorts: [{
    count: 1, membership: "baseline", ageDecade: "twenties", schoolStage: "university",
    scope: { kind: "logical_days", tripId: catalog.tripId, tripRevision: 2, dayIds: catalog.days.map(d => d.id) },
  }] }, "PRIVATE_TURN", overlay));
  const receipt = publicSemanticReceipt(accepted.receipt), current = compileEffectiveIntent({ overlay: accepted.overlay });
  expect(conditionDisplayLines([receipt], current, catalog)).toEqual(["同行者の詳細：20代・大学生 1人（1〜2日目、全体人数の内数）"]);
  expect(JSON.stringify(conditionDisplayLines([receipt], current, catalog))).not.toContain("PRIVATE");
  expect(conditionDisplayLines([receipt], current, { ...catalog, tripRevision: 3 })[0]).toContain("要確認");
});
