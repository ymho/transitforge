import { createConversationServerAgent } from "./conversation-server-agent.js";
import { DynamoDbConversationRepository } from "../adapters/dynamodb-conversation-repository.js";
import type { ConversationTurnInput } from "../usecases/agent/conversation-turn.js";
import { StateError } from "../contracts/server-state.js";
import type { AgentProgressReporter } from "@raiquora/agent/agent-progress";

/** Streaming follows an already-created, owner-scoped Trip history. It never creates resources. */
export function createProductionConversationAgent(options: Parameters<typeof createConversationServerAgent>[0]) {
  const conversations = new DynamoDbConversationRepository(options.stateTable, options.stateClient);
  const application = createConversationServerAgent(options);
  return { async runConversationTurn(input: ConversationTurnInput, reportProgress?: AgentProgressReporter) {
    const conversation = await conversations.get(input.principal, input.conversationId);
    if (!conversation) throw new StateError("not-found");
    if (input.tripId !== undefined && conversation.tripId !== input.tripId) throw new StateError("invalid-input");
    return application.runConversationTurn(input, reportProgress);
  } };
}
