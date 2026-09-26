import { expect, it } from "vitest";
import { stateDynamoFixture, stateA, conversationId, secondId, stateMetadata } from "./state-dynamodb.fixture.js";
import { DynamoDbConversationTurnRepository } from "./dynamodb-conversation-turn-repository.js";
import type { ConversationTurnResult } from "../ports/conversation-turn-repository.js";

const result: ConversationTurnResult = { status: "completed", response: "散策先の候補です。", publicPlacePresentation: {
  version: "public-place-presentation-v1", cards: [{ evidenceId: "evidence:garden", placeRef: "place:fixture:garden",
    title: "青葉庭園", description: "資料の抜粋です。", sourceUrl: "https://example.org/garden" }],
} };
const identity = { principal: stateA, conversationId, turnId: secondId };
async function setup() {
  const state = stateDynamoFixture();
  await state.conversations.create(stateA, conversationId, stateMetadata());
  const turns = new DynamoDbConversationTurnRepository("test-state", state.client);
  const begun = await turns.beginTurn(identity, { userRequest: "候補を見たい" });
  if (begun.state === "completed") throw new Error("Expected fresh turn");
  return { state, turns, lease: begun.lease };
}

it("persists a detached card snapshot and fences a different card body on repeated completion", async () => {
  const { turns, state, lease } = await setup();
  const input = structuredClone(result);
  const saved = await turns.completeTurn(identity, lease, input);
  input.publicPlacePresentation!.cards[0]!.title = "別の名前";
  expect(saved.publicPlacePresentation!.cards[0]!.title).toBe("青葉庭園");
  expect(await turns.completeTurn(identity, lease, structuredClone(result))).toEqual(result);
  await expect(turns.completeTurn(identity, lease, input)).rejects.toMatchObject({ code: "conflict" });
  const history = await state.conversations.history(stateA, conversationId);
  expect(history.items).toHaveLength(2);
  expect(history.items[1]?.publicPlacePresentation).toEqual(result.publicPlacePresentation);
});
it("rejects invalid card envelopes before committing an assistant history message", async () => {
  const { turns, state, lease } = await setup();
  const invalid = structuredClone(result);
  invalid.publicPlacePresentation!.cards[0]!.sourceUrl = "javascript:alert(1)";
  await expect(turns.completeTurn(identity, lease, invalid)).rejects.toMatchObject({ code: "invalid-input" });
  expect((await state.conversations.history(stateA, conversationId)).items).toHaveLength(1);
  expect(await turns.completeTurn(identity, lease, structuredClone(result))).toEqual(result);
});
