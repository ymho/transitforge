import { describe, expect, it } from "vitest";
import { emptyConversationIntentOverlay, type AcceptedIntentDelta } from "@raiquora/trip/conversation-intent";
import { reduceConversationIntent } from "./conversation-intent-reducer";

const turnId = "00000000-0000-4000-8000-000000000001";
function delta(mutationId: string, baseIntentRevision: number, operations: AcceptedIntentDelta["operations"]): AcceptedIntentDelta {
  return { version: 1, mutationId, baseIntentRevision, speechAct: "inform", operations: [...operations] };
}
function op(id: string, action: AcceptedIntentDelta["operations"][number]["action"], target: AcceptedIntentDelta["operations"][number]["target"], value?: AcceptedIntentDelta["operations"][number]["value"]) {
  return { operationId: id, groupId: `group-${id}`, action, target, scope: { type: "conversation" as const }, modality: "preferred" as const,
    precision: "exact" as const, ...(value ? { value } : {}), frame: "actual" as const, provenance: { kind: "user_turn" as const, turnId, quote: id } };
}

describe("reduceConversationIntent", () => {
  it("adds an alternative without replacing the selected value", () => {
    const first = reduceConversationIntent(emptyConversationIntentOverlay(), delta("m1", 0, [op("o1", "set", "destination", { kind: "place_label", label: "金沢" })]));
    const second = reduceConversationIntent(first.overlay, delta("m2", 1, [op("o2", "add_alternative", "destination", { kind: "place_label", label: "富山" })]));
    expect(second.overlay.facts.map(({ value }) => value)).toEqual([{ kind: "place_label", label: "金沢" }, { kind: "place_label", label: "富山" }]);
  });

  it("replaces only the matching target and preserves unrelated scope", () => {
    const first = reduceConversationIntent(emptyConversationIntentOverlay(), delta("m1", 0, [
      op("o1", "set", "destination", { kind: "place_label", label: "金沢" }),
      op("o2", "set", "budget", { kind: "money", amount: 30_000, currency: "JPY", basis: "per_person" }),
    ]));
    const second = reduceConversationIntent(first.overlay, delta("m2", 1, [op("o3", "replace", "destination", { kind: "place_label", label: "富山" })]));
    expect(second.overlay.facts.find(({ target }) => target === "destination")?.value).toEqual({ kind: "place_label", label: "富山" });
    expect(second.overlay.facts.find(({ target }) => target === "budget")?.value).toMatchObject({ amount: 30_000 });
  });

  it("retracts with a tombstone and does not revive the old value", () => {
    const first = reduceConversationIntent(emptyConversationIntentOverlay(), delta("m1", 0, [op("o1", "set", "origin", { kind: "place_label", label: "大阪" })]));
    const second = reduceConversationIntent(first.overlay, delta("m2", 1, [op("o2", "retract", "origin")]));
    expect(second.overlay.facts).toEqual([]);
    expect(second.overlay.tombstones).toMatchObject([{ target: "origin", reason: "retracted" }]);
  });

  it("keeps hypothetical changes isolated from the actual conversation intent", () => {
    const actual = reduceConversationIntent(emptyConversationIntentOverlay(), delta("m1", 0, [
      op("o1", "set", "party_size", { kind: "quantity", amount: 1, unit: "people" }),
    ]));
    const hypotheticalOperation = { ...op("o2", "set", "party_size", { kind: "quantity", amount: 2, unit: "people" }),
      frame: "hypothetical" as const };
    const withHypothesis = reduceConversationIntent(actual.overlay, delta("m2", 1, [hypotheticalOperation]));
    expect(withHypothesis.overlay.facts.map(({ frame, value }) => [frame, value])).toEqual([
      ["actual", { kind: "quantity", amount: 1, unit: "people" }],
      ["hypothetical", { kind: "quantity", amount: 2, unit: "people" }],
    ]);

    const hypotheticalRetract = { ...op("o3", "retract", "party_size"), frame: "hypothetical" as const };
    const retracted = reduceConversationIntent(withHypothesis.overlay, delta("m3", 2, [hypotheticalRetract]));
    expect(retracted.overlay.facts).toMatchObject([{ frame: "actual", value: { amount: 1 } }]);
    expect(retracted.overlay.tombstones).toMatchObject([{ target: "party_size", frame: "hypothetical", reason: "retracted" }]);
  });

  it("replays a mutation without advancing intentRevision", () => {
    const input = delta("m1", 0, [op("o1", "set", "destination", { kind: "place_label", label: "金沢" })]);
    const first = reduceConversationIntent(emptyConversationIntentOverlay(), input);
    const replay = reduceConversationIntent(first.overlay, { ...input, baseIntentRevision: 1 });
    expect(replay.overlay.intentRevision).toBe(1);
    expect(replay.receipt.replayed).toBe(true);
    expect(replay.overlay.facts).toHaveLength(1);
  });

  it("rejects a whole dependent group when one transition lacks a target", () => {
    const operations = [op("o1", "set", "destination", { kind: "place_label", label: "富山" }), op("o2", "replace", "origin", { kind: "place_label", label: "大阪" })];
    operations[1] = { ...operations[1]!, groupId: operations[0]!.groupId };
    const result = reduceConversationIntent(emptyConversationIntentOverlay(), delta("m1", 0, operations));
    expect(result.overlay.facts).toEqual([]);
    expect(result.receipt.operations.every(({ status }) => status === "rejected")).toBe(true);
  });
});
