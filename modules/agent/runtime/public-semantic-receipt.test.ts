import { expect, it } from "vitest";
import { parsePublicSemanticReceipt, publicSemanticReceipt } from "./public-semantic-receipt";

it("projects only bounded status and references from an accepted intent receipt", () => {
  const projected = publicSemanticReceipt({ version: 1, mutationId: "mutation", speechAct: "correct", beforeIntentRevision: 1,
    intentRevision: 2, replayed: false, operations: [{ operationId: "operation", groupId: "group", action: "replace", target: "destination",
      scope: { type: "trip", tripId: "PRIVATE-TRIP" }, frame: "actual", status: "accepted", reason: "applied", beforeFactRefs: ["old"], afterFactRefs: ["new"] }] });
  expect(projected).toEqual({ version: "public-semantic-receipt-v1", intentRevision: 2, speechAct: "correct", outcome: "accepted",
    changes: [{ changeRef: "operation", groupRef: "group", action: "replace", target: "destination", scope: { type: "trip" }, frame: "actual", status: "accepted" }] });
  expect(JSON.stringify(projected)).not.toMatch(/PRIVATE-TRIP|beforeFactRefs|afterFactRefs|reason|quote|value/);
  expect(parsePublicSemanticReceipt(projected)).toEqual(projected);
});

it("rejects unknown fields and oversized change lists", () => {
  expect(() => parsePublicSemanticReceipt({ version: "public-semantic-receipt-v1", intentRevision: 1, speechAct: "inform", outcome: "accepted", changes: [], private: true })).toThrow();
  expect(() => parsePublicSemanticReceipt({ version: "public-semantic-receipt-v1", intentRevision: 1, speechAct: "inform", outcome: "accepted",
    changes: Array.from({ length: 13 }, (_, index) => ({ changeRef: String(index), groupRef: "g", action: "set", target: "goal", scope: { type: "conversation" }, frame: "actual", status: "accepted" })) })).toThrow();
});
