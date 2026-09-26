import { expect, it, vi } from "vitest";
import { createConversationConditionApplication } from "./conversation-condition-application.js";
import { StateError } from "../../contracts/server-state.js";
import { stateA, conversationId, secondId } from "../../adapters/state-dynamodb.fixture.js";
const identity = { principal: stateA, conversationId, turnId: secondId };
const lease = { attemptId: "71600000-0000-4000-8000-000000000001", userSequence: 1 };
it("validates the source before persistence and never accepts model-supplied authority", async () => {
  const acceptCondition = vi.fn();
  const apply = createConversationConditionApplication({ acceptCondition }, identity, lease, "大阪から京都に行きたい");
  await expect(apply({ target: "destination", place: "神戸", quote: "京都" })).rejects.toMatchObject({ code: "invalid_source" });
  expect(acceptCondition).not.toHaveBeenCalled();
  await apply({ target: "origin", place: "大阪", quote: "大阪から" });
  expect(acceptCondition).toHaveBeenCalledWith(identity, lease, { target: "origin", place: "大阪", quote: "大阪から" });
});
it("accepts one grounded party operation without Profile or persistence metadata from the model", async () => {
  const acceptCondition = vi.fn(async () => ({ version: 1 as const, mutationId: "condition:party", speechAct: "inform" as const,
    beforeIntentRevision: 0, intentRevision: 1, replayed: false, operations: [] }));
  const apply = createConversationConditionApplication({ acceptCondition }, identity, lease, "大人2人と子ども1人で行きたい");
  const change = { target: "party_size" as const, party: { kind: "composition" as const, adults: 2, children: 1 },
    quote: "大人2人と子ども1人" };
  await apply(change);
  expect(acceptCondition).toHaveBeenCalledWith(identity, lease, change);
  await expect(apply({ ...change, quote: "別の発言" })).rejects.toMatchObject({ code: "invalid_source" });
});

it("separates a definite conflict from an uncertain storage result", async () => {
  const acceptCondition = vi.fn().mockRejectedValueOnce(new StateError("conflict")).mockRejectedValueOnce(new StateError("unavailable"));
  const apply = createConversationConditionApplication({ acceptCondition }, identity, lease, "京都に行きたい");
  await expect(apply({ target: "destination", place: "京都", quote: "京都" })).rejects.toMatchObject({ code: "condition_conflict" });
  await expect(apply({ target: "destination", place: "京都", quote: "京都" })).rejects.toBeInstanceOf(StateError);
});
