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
it("separates a definite conflict from an uncertain storage result", async () => {
  const acceptCondition = vi.fn().mockRejectedValueOnce(new StateError("conflict")).mockRejectedValueOnce(new StateError("unavailable"));
  const apply = createConversationConditionApplication({ acceptCondition }, identity, lease, "京都に行きたい");
  await expect(apply({ target: "destination", place: "京都", quote: "京都" })).rejects.toMatchObject({ code: "condition_conflict" });
  await expect(apply({ target: "destination", place: "京都", quote: "京都" })).rejects.toBeInstanceOf(StateError);
});
