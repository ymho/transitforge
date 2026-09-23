import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { createConversationTurnApplication } from "../usecases/agent/conversation-turn.js";
import { createStatefulServerAgent } from "./stateful-server-agent.js";

/** Internal opt-in only. No production handler, environment binding or transport is changed. */
export function createConversationServerAgent(options: Omit<Parameters<typeof createStatefulServerAgent>[0], "historyBeforeSequence">) {
  return createConversationTurnApplication({
    turns: new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient),
    runAgentTurn: (input, historyBeforeSequence) => createStatefulServerAgent({ ...options, historyBeforeSequence }).runAgentTurn(input),
    diagnostics: options.diagnostics,
    log: options.log,
  });
}
