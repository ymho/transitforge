import { registerCostProposalTool } from "../usecases/agent/cost-proposal-tool.js";
import type { PublicCostProposal } from "@raiquora/trip/public-cost-proposal";
import type { Trip } from "@raiquora/trip/trip";
import { parsePublicRequestProposal, type PublicRequestProposal } from "@raiquora/trip/public-request-proposal";
import type { ServerAgentTurn } from "../usecases/agent/server-agent.js";
import type { AgentProgressReporter } from "@raiquora/agent/agent-progress";
import { registerRequestProposalTool } from "../usecases/agent/request-proposal-tool.js";
import { DynamoDbConversationRepository } from "../adapters/dynamodb-conversation-repository.js";
import { DynamoDbProfileRepository } from "../adapters/dynamodb-profile-repository.js";
import { DynamoDbTripRepository, type TripDynamoClient } from "../adapters/dynamodb-trip-repository.js";
import type { StateDynamoClient } from "../adapters/dynamodb-state-store.js";
import { ConversationApplication } from "../usecases/conversation-application.js";
import { ProfileApplication } from "../usecases/profile-application.js";
import { createServerStateContextLoader } from "../usecases/agent/server-state-context-loader.js";
import { createServerAgent } from "../server-agent-composition.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { registerTripReadTools } from "../usecases/agent/trip-read-tool.js";
import { DynamoDbItineraryCandidateRepository } from "../adapters/dynamodb-itinerary-candidate-repository.js";
import { PlanCandidateRetentionApplication, registerPlanCandidateRetentionTool, type RetainedCandidatePlan } from "../usecases/plan-candidate-retention.js";
import { proposeVerifiedIntentRequest } from "@raiquora/agent/verified-intent-proposal";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import type { IntentApplicationReceipt } from "@raiquora/agent/conversation-intent-reducer";
import { publicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
import type { ConversationConditionInput } from "@raiquora/agent/conversation-condition";
import { TripApplication } from "../usecases/trip-application.js";
import { createHash } from "node:crypto";

/** Internal stateful composition. Transport/auth rollout and env bindings remain with #451/#462/#480. */
export function createStatefulServerAgent(options: Omit<Parameters<typeof createServerAgent>[0], "loadContext"> & {
  /** Trusted composition option for persisted turns; excludes the current input from history. */
  historyBeforeSequence?: number;
  stateTable: string;
  tripTable: string;
  stateClient?: StateDynamoClient;
  tripClient?: TripDynamoClient;
}) {
  return { async runAgentTurn(input: ServerAgentTurn, reportProgress?: AgentProgressReporter,
    acceptCondition?: (change: ConversationConditionInput) => Promise<IntentApplicationReceipt>) {
    let tripCostProposal: PublicCostProposal | undefined, retainedCandidatePlan: RetainedCandidatePlan | undefined;
    let trip: Trip | undefined, tripUpdateProposal: PublicRequestProposal | undefined;
    let effectiveIntent: EffectiveIntent | undefined, currentIntentReceipt: IntentApplicationReceipt | undefined;
    const turnStates = new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient);
    const tripRepository = new DynamoDbTripRepository(options.tripTable, options.tripClient);
    const tripApplication = new TripApplication(tripRepository, tripRepository, undefined, undefined, undefined, undefined, turnStates);
    const contextLoader = createServerStateContextLoader({
      conversations: new ConversationApplication(new DynamoDbConversationRepository(options.stateTable, options.stateClient),
        new DynamoDbItineraryCandidateRepository(options.tripTable, options.tripClient)),
      profiles: new ProfileApplication(new DynamoDbProfileRepository(options.stateTable, options.stateClient)),
      trips: tripRepository,
      workingStates: turnStates,
    }, { historyBeforeSequence: options.historyBeforeSequence, onTrip: value => { trip = value; },
      onEffectiveIntent: value => { effectiveIntent = value.effectiveIntent; currentIntentReceipt = value.currentReceipt; } });
    const runtime = options.runRuntime;
    const runRuntime = runtime ? async (runtimeInput: Parameters<typeof runtime>[0]) =>
      runtime({
        ...runtimeInput,
        ...(acceptCondition ? { conditionController: {
          apply: async (change: ConversationConditionInput) => {
            const receipt = await acceptCondition(change);
            const refreshed = await contextLoader({
              principal: input.principal,
              ...(input.conversationId ? { conversationId: input.conversationId } : {}),
              ...(input.tripId ? { tripId: input.tripId } : {}),
              ...(input.uiContext ? { uiContext: input.uiContext } : {}),
            });
            if (!refreshed.effectiveIntent || !trip || !input.conversationId) throw new Error("Accepted intent requires a refreshed Trip snapshot");
            const proposal = proposeVerifiedIntentRequest({ conversationId: input.conversationId, trip, effectiveIntent: refreshed.effectiveIntent, receipt });
            if (proposal) {
              const mutationId = deterministicConditionMutationId(receipt.mutationId);
              await tripApplication.execute(input.principal, { version: "trip-api-v1", operation: "mutate", tripId: trip.id,
                baseRevision: proposal.baseRevision, mutationId, proposal });
              const committed = await contextLoader({
                principal: input.principal, conversationId: input.conversationId, tripId: trip.id,
                ...(input.uiContext ? { uiContext: input.uiContext } : {}),
              });
              if (!committed.effectiveIntent) throw new Error("Committed condition requires a refreshed Trip snapshot");
              return { receipt: publicSemanticReceipt(receipt), effectiveIntent: committed.effectiveIntent };
            }
            // Partial conditions that cannot yet be represented in TripRequest are handled by
            // the next #761 slice; never claim Trip adoption for them here.
            return { receipt: publicSemanticReceipt(receipt), effectiveIntent: refreshed.effectiveIntent };
          },
        } } : {}),
      }) : undefined;
    const result = await createServerAgent({ ...options,
      registerAdditionalTools: (tools, evidence, scope) => {
        options.registerAdditionalTools?.(tools, evidence, scope);
        if (trip) {
          registerTripReadTools(tools, evidence, trip);
          registerRequestProposalTool(tools, trip, proposal => { tripUpdateProposal = proposal; });
          registerCostProposalTool(tools, trip, proposal => { tripCostProposal = proposal; });
          if (scope.conversationId) {
            const candidateRepository = new DynamoDbItineraryCandidateRepository(options.tripTable, options.tripClient);
            registerPlanCandidateRetentionTool(tools, new PlanCandidateRetentionApplication(candidateRepository), {
              principal: scope.principal, executionId: scope.executionId, conversationId: scope.conversationId, userRequest: scope.userRequest,
              tripId: trip.id, baseTripRevision: trip.revision,
            }, value => { retainedCandidatePlan = value; });
          }
        }
      },
      // Restored private state may be echoed in any later turn block. Do not retain raw model-call traces.
      // Runtime metadata/latency diagnostics remain available; no Bedrock/provider implementation change.
      model: { converse: ({ trace: _trace, ...request }) => options.model.converse(request) },
      loadContext: contextLoader,
      ...(runRuntime ? { runRuntime } : {}),
    }).runAgentTurn(input, reportProgress);
    if (!options.runRuntime && input.conversationId && effectiveIntent && currentIntentReceipt && trip) {
      const verified = proposeVerifiedIntentRequest({ conversationId: input.conversationId, trip, effectiveIntent, receipt: currentIntentReceipt });
      if (verified) tripUpdateProposal = parsePublicRequestProposal(verified);
    }
    return { ...result, ...((result.status === "completed" || result.status === "follow_up") && retainedCandidatePlan ? { publicPlanPresentation: retainedCandidatePlan.presentation } : {}),
      ...((result.status === "completed" || result.status === "follow_up") && tripCostProposal ? { tripCostProposal } : {}), ...((result.status === "completed" || result.status === "follow_up") && tripUpdateProposal ? { tripUpdateProposal } : {}) };
  } };
}

function deterministicConditionMutationId(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}
