import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { createConversationTurnApplication } from "../usecases/agent/conversation-turn.js";
import { createStatefulServerAgent } from "./stateful-server-agent.js";
import { createConversationIntentInterpreter } from "../usecases/agent/conversation-intent-interpreter.js";
import { DynamoDbTripRepository } from "../adapters/dynamodb-trip-repository.js";
import { TripApplication } from "../usecases/trip-application.js";
import { createHash } from "node:crypto";

/** Conversation state is Application-owned; an injected V2 runtime never uses the V1 interpreter. */
export function createConversationServerAgent(options: Omit<Parameters<typeof createStatefulServerAgent>[0], "historyBeforeSequence"> & { semanticIntentEnabled?: boolean }) {
  const turns = new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient);
  const trips = new DynamoDbTripRepository(options.tripTable, options.tripClient);
  const tripApplication = new TripApplication(trips, trips, undefined, undefined, undefined, undefined, turns);
  return createConversationTurnApplication({
    turns, ...(options.runRuntime ? { conditions: turns } : {}),
    adoptTripProposal: async (identity, lease, proposal) => {
      await turns.stageIntentProposal(identity, lease, proposal);
      await tripApplication.execute(identity.principal, { version: "trip-api-v1", operation: "mutate",
        tripId: proposal.tripId, baseRevision: proposal.baseRevision, mutationId: stableMutationId(proposal.intentBinding!.changes.map(({ changeRef }) => changeRef).join("|")), proposal });
    },
    ...(options.semanticIntentEnabled && !options.runRuntime ? { interpretIntent: createConversationIntentInterpreter(options.model) } : {}),
    runAgentTurn: (input, historyBeforeSequence, reportProgress, acceptCondition) =>
      createStatefulServerAgent({ ...options, historyBeforeSequence }).runAgentTurn(input, reportProgress, acceptCondition),
    diagnostics: options.diagnostics,
    log: options.log,
  });
}

function stableMutationId(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}
