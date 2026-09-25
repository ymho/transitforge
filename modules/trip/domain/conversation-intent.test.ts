import { describe, expect, it } from "vitest";
import { emptyConversationIntentOverlay, parseAcceptedIntentDelta, parseConversationIntentOverlay } from "./conversation-intent";

const operation = { operationId: "op-1", groupId: "group-1", action: "set", target: "duration", scope: { type: "conversation" },
  modality: "acceptable", precision: "approximate", value: { kind: "quantity", amount: 2, unit: "nights" }, frame: "actual",
  provenance: { kind: "user_turn", turnId: "00000000-0000-4000-8000-000000000001", quote: "2泊くらい" } } as const;

describe("conversation intent contracts", () => {
  it("round-trips an accepted sparse delta without owner or revision metadata from a model", () => {
    const delta = parseAcceptedIntentDelta({ version: 1, mutationId: "turn-1", baseIntentRevision: 3, operations: [operation] });
    expect(delta.operations[0]).toEqual(operation);
    expect(JSON.parse(JSON.stringify(delta))).toEqual(delta);
  });

  it("keeps acceptable, approximate, range and unknown as independent axes", () => {
    const delta = parseAcceptedIntentDelta({ version: 1, mutationId: "turn-2", baseIntentRevision: 0, operations: [operation,
      { ...operation, operationId: "op-2", groupId: "group-2", target: "budget", modality: "preferred", precision: "range",
        value: { kind: "money", amount: 30_000, basis: "per_person" } },
      { ...operation, operationId: "op-3", groupId: "group-3", target: "origin", modality: "preferred", precision: "qualitative",
        value: { kind: "unknown", reason: "undecided" } },
    ] });
    expect(delta.operations.map(({ modality, precision, value }) => [modality, precision, value?.kind])).toEqual([
      ["acceptable", "approximate", "quantity"], ["preferred", "range", "money"], ["preferred", "qualitative", "unknown"],
    ]);
  });

  it("rejects unknown fields, duplicate targets in an atomic group and oversized state", () => {
    expect(() => parseAcceptedIntentDelta({ version: 1, mutationId: "x", baseIntentRevision: 0, operations: [{ ...operation, owner: "attacker" }] })).toThrow();
    expect(() => parseAcceptedIntentDelta({ version: 1, mutationId: "x", baseIntentRevision: 0, operations: [operation, { ...operation, operationId: "op-2" }] })).toThrow();
    expect(() => parseConversationIntentOverlay({ ...emptyConversationIntentOverlay(), appliedMutationIds: Array.from({ length: 65 }, (_, index) => `m-${index}`) })).toThrow();
  });
});
