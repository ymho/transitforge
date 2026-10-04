import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { createConversationTurnApplication } from "../usecases/agent/conversation-turn.js";
import { createStatefulServerAgent } from "./stateful-server-agent.js";
import { DynamoDbTripRepository } from "../adapters/dynamodb-trip-repository.js";
import { TripApplication } from "../usecases/trip-application.js";
import { createHash } from "node:crypto";

/** Conversation state and condition acceptance are Application-owned. */
export function createConversationServerAgent(options: Omit<Parameters<typeof createStatefulServerAgent>[0], "historyBeforeSequence">) {
  const turns = new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient);
  const trips = new DynamoDbTripRepository(options.tripTable, options.tripClient);
  const tripApplication = new TripApplication(trips, trips, undefined, undefined, undefined, undefined, turns);
  return createConversationTurnApplication({
    turns, conditions: turns,
    adoptTripProposal: async (identity, lease, proposal) => {
      await turns.stageIntentProposal(identity, lease, proposal);
      const mutationId = stableMutationId(proposal.intentBinding!.changes.map(({ changeRef }) => changeRef).join("|"));
      try {
        await tripApplication.execute(identity.principal, { version: "trip-api-v1", operation: "mutate",
          tripId: proposal.tripId, baseRevision: proposal.baseRevision, mutationId, proposal });
      } catch (error) {
        // A Trip transaction may have committed while the adoption-complete response was lost.
        // Re-read the Trip and finish the same binding; never issue a different mutation.
        const saved = await trips.get(identity.principal, proposal.tripId).catch(() => undefined);
        if (!saved || saved.revision !== proposal.baseRevision + 1) throw error;
        await turns.complete(identity.principal, { binding: proposal.intentBinding!, tripId: proposal.tripId,
          baseTripRevision: proposal.baseRevision, committedTripRevision: saved.revision, mutationId });
      }
    },
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
