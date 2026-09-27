import { expect, it } from "vitest";
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
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
