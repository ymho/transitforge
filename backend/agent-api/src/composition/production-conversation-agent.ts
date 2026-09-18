import { createConversationServerAgent } from "./conversation-server-agent.js";
import { DynamoDbConversationRepository } from "../adapters/dynamodb-conversation-repository.js";
import type { ConversationTurnInput } from "../usecases/agent/conversation-turn.js";
import { StateError } from "../contracts/server-state.js";

/** A new client-generated UUID starts an empty server conversation, never imports local history. */
export function createProductionConversationAgent(options: Parameters<typeof createConversationServerAgent>[0]) {
  const conversations = new DynamoDbConversationRepository(options.stateTable, options.stateClient);
  const application = createConversationServerAgent(options);
  return { async runConversationTurn(input: ConversationTurnInput) {
    if (!await conversations.get(input.principal, input.conversationId)) {
      try {
        await conversations.create(input.principal, input.conversationId, {
          title: input.userRequest.slice(0, 160), scope: input.tripId ? "trip" : "general", summary: "",
          resolvedTopics: [], pendingTopics: [], ...(input.tripId ? { tripId: input.tripId } : {}),
        });
      } catch (error) {
        // Concurrent initial requests may create once. A tombstone is never resurrected.
        if (!(error instanceof StateError) || error.code !== "conflict" || !await conversations.get(input.principal, input.conversationId)) throw error;
      }
    }
    return application.runConversationTurn(input);
  } };
}
