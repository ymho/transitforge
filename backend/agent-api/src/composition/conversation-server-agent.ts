import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { createConversationTurnApplication } from "../usecases/agent/conversation-turn.js";
import { createStatefulServerAgent } from "./stateful-server-agent.js";
import { createConversationIntentInterpreter } from "../usecases/agent/conversation-intent-interpreter.js";

/** Conversation state is Application-owned; an injected V2 runtime never uses the V1 interpreter. */
export function createConversationServerAgent(options: Omit<Parameters<typeof createStatefulServerAgent>[0], "historyBeforeSequence"> & { semanticIntentEnabled?: boolean }) {
  return createConversationTurnApplication({
    turns: new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient),
    ...(options.semanticIntentEnabled && !options.runRuntime ? { interpretIntent: createConversationIntentInterpreter(options.model) } : {}),
    runAgentTurn: (input, historyBeforeSequence, reportProgress, acceptIntent) =>
      createStatefulServerAgent({ ...options, historyBeforeSequence }).runAgentTurn(input, reportProgress, acceptIntent),
    diagnostics: options.diagnostics,
    log: options.log,
  });
}
