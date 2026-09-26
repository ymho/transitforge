import { describe, expect, it } from "vitest";
import { z } from "zod";
import { admitConditionChange, conditionDelta, conditionOperationId, conditionPayload, placeConditionInputSchema, clearConditionInputSchema } from "./conversation-condition";
import { reduceConversationIntent } from "./conversation-intent-reducer";
import { compileEffectiveIntent } from "./effective-intent";
import type { ConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
const turn = "71600000-0000-4000-8000-000000000001";
const empty = (): ConversationIntentOverlay => ({ version: 1, intentRevision: 0, facts: [], tombstones: [], appliedMutationIds: [] });

describe("small Conversation condition operations", () => {
  it("has one strict Zod syntax with no interpretation metadata or model-selected authority", () => {
    const schema = z.toJSONSchema(placeConditionInputSchema);
    expect(schema.required).toEqual(["place", "quote"]);
    expect(schema.additionalProperties).toBe(false);
    expect(placeConditionInputSchema.safeParse({ place: "京都", quote: "京都" }).success).toBe(true);
    expect(placeConditionInputSchema.safeParse({ place: null, quote: "未定に戻す" }).success).toBe(false);
    expect(clearConditionInputSchema.safeParse({ quote: "未定に戻す" }).success).toBe(true);
    expect(clearConditionInputSchema.safeParse({ place: "京都", quote: "京都" }).success).toBe(false);
    for (const extra of ["owner", "turnId", "revision", "mutationId", "speechAct", "outcome", "operations", "atomicGroup"])
      expect(placeConditionInputSchema.safeParse({ place: "京都", quote: "京都", [extra]: "injected" }).success).toBe(false);
  });
  it("rejects missing values, unsupported types and labels not grounded in the current message", () => {
    for (const input of [{ quote: "京都" }, { place: 2, quote: "京都" }, { place: "京都", quote: "大阪" }])
      expect(() => admitConditionChange({ target: "destination", ...input }, "京都に行きたい")).toThrow();
    expect(() => admitConditionChange({ target: "destination", place: "神戸", quote: "京都" }, "京都に行きたい")).toThrow("invalid_source");
  });
  it("sets, replaces and retracts without an interpreter and preserves independent conditions", () => {
    let overlay = empty();
    for (const [index, change] of [
      { target: "origin", place: "大阪", quote: "大阪" },
      { target: "destination", place: "京都", quote: "京都" },
      { target: "destination", place: "神戸", quote: "神戸" },
      { target: "destination", place: null, quote: "未定" },
    ].entries()) {
      const accepted = admitConditionChange(change, "大阪 京都 神戸 未定");
      overlay = reduceConversationIntent(overlay, conditionDelta(accepted, `71600000-0000-4000-8000-00000000000${index + 1}`, overlay)).overlay;
    }
    expect(overlay.facts.map(({ target, value }) => ({ target, value }))).toEqual([{ target: "origin", value: { kind: "place_label", label: "大阪" } }]);
    expect(overlay.tombstones).toContainEqual(expect.objectContaining({ target: "destination" }));
    expect(compileEffectiveIntent({ overlay }).actualConversationFacts).toHaveLength(1);
  });
  it("identifies a final condition decision independently of SDK call order and quote selection", () => {
    const a = admitConditionChange({ target: "destination", place: "京都", quote: "京都" }, "京都に行きたい");
    const b = admitConditionChange({ target: "destination", place: "京都", quote: "京都に行きたい" }, "京都に行きたい");
    expect(conditionPayload(a)).toBe(conditionPayload(b));
    expect(conditionOperationId(turn, a.target)).not.toBe(conditionOperationId(turn, "origin"));
    expect(conditionOperationId(turn, a.target)).not.toBe(conditionOperationId("71600000-0000-4000-8000-000000000002", a.target));
  });
});
