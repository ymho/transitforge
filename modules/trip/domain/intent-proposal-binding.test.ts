import { expect, it } from "vitest";
import { parseIntentProposalBinding } from "./intent-proposal-binding";

const valid = { version: "intent-proposal-binding-v1", conversationId: "conversation",
  intentRevision: 3, effectiveIntentFingerprint: "intent-1234abcd", changes: [{ changeRef: "change", groupRef: "group",
    action: "replace", target: "origin", scope: { type: "conversation" } }] } as const;

it("accepts an Application intent binding and returns a defensive copy", () => {
  const parsed = parseIntentProposalBinding(valid);
  expect(parsed).toEqual(valid); expect(parsed).not.toBe(valid);
});

it.each([
  { ...valid, intentRevision: 0 },
  { ...valid, effectiveIntentFingerprint: "raw-model-value" },
  { ...valid, changes: [] },
  { ...valid, changes: [...valid.changes, valid.changes[0]] },
  { ...valid, changes: [{ ...valid.changes[0], scope: { type: "trip" } }] },
  { ...valid, owner: "forged" },
])("rejects stale, forged, duplicate, or structurally incomplete bindings", (value) => {
  expect(() => parseIntentProposalBinding(value)).toThrow();
});
