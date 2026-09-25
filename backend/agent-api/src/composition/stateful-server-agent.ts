import { registerCostProposalTool } from "../usecases/agent/cost-proposal-tool.js";
import type { PublicCostProposal } from "@raiquora/trip/public-cost-proposal";
import { createTrip } from "@raiquora/trip/trip";
import { parseConsultationRequestProposal, type ConsultationRequestProposal } from "@raiquora/trip/consultation-request-proposal";
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

/** Internal stateful composition. Transport/auth rollout and env bindings remain with #451/#462/#480. */
export function createStatefulServerAgent(options: Omit<Parameters<typeof createServerAgent>[0], "loadContext"> & {
  /** Trusted composition option for persisted turns; excludes the current input from history. */
  historyBeforeSequence?: number;
  stateTable: string;
  tripTable: string;
  stateClient?: StateDynamoClient;
  tripClient?: TripDynamoClient;
}) {
  return { async runAgentTurn(input: ServerAgentTurn, reportProgress?: AgentProgressReporter) {
    let tripCostProposal: PublicCostProposal | undefined, retainedCandidatePlan: RetainedCandidatePlan | undefined;
    let trip: Trip | undefined, consultation: Trip | undefined, tripUpdateProposal: PublicRequestProposal | undefined, consultationRequestProposal: ConsultationRequestProposal | undefined;
    let effectiveIntent: EffectiveIntent | undefined, currentIntentReceipt: IntentApplicationReceipt | undefined;
    const turnStates = new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient);
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
        else if (consultation) {
          const base = consultation;
          // Trip-shaped input reuses pure request rules only; never publish or persist it as a Trip.
          registerRequestProposalTool(tools, base, proposal => {
            consultationRequestProposal = parseConsultationRequestProposal({ conversationId: base.id, baseRequest: base.request,
              request: proposal.patches[0].request, summary: proposal.summary });
          });
        }
      },
      // Restored private state may be echoed in any later turn block. Do not retain raw model-call traces.
      // Runtime metadata/latency diagnostics remain available; no Bedrock/provider implementation change.
      model: { converse: ({ trace: _trace, ...request }) => options.model.converse(request) },
      loadContext: createServerStateContextLoader({
        conversations: new ConversationApplication(new DynamoDbConversationRepository(options.stateTable, options.stateClient),
          new DynamoDbItineraryCandidateRepository(options.tripTable, options.tripClient)),
        profiles: new ProfileApplication(new DynamoDbProfileRepository(options.stateTable, options.stateClient)),
        trips: new DynamoDbTripRepository(options.tripTable, options.tripClient),
        workingStates: turnStates,
      }, { historyBeforeSequence: options.historyBeforeSequence, onTrip: value => { trip = value; },
        onConsultation: value => { consultation = createTrip(value.conversationId, "相談中の条件", value.createdAt, [], value.request); },
        onEffectiveIntent: value => { effectiveIntent = value.effectiveIntent; currentIntentReceipt = value.currentReceipt; } }),
    }).runAgentTurn(input, reportProgress);
    if (input.conversationId && effectiveIntent && currentIntentReceipt) {
      const base = trip ?? consultation;
      if (base) {
        const verified = proposeVerifiedIntentRequest({ conversationId: input.conversationId, trip: base, effectiveIntent, receipt: currentIntentReceipt });
        if (verified) {
          if (trip) tripUpdateProposal = parsePublicRequestProposal(verified);
          else {
            const patch = verified.patches[0];
            if (patch?.type !== "request") throw new Error("Verified intent projection must be request-only");
            consultationRequestProposal = parseConsultationRequestProposal({ conversationId: base.id, baseRequest: base.request,
              request: patch.request, summary: verified.summary, intentBinding: verified.intentBinding });
          }
        }
      }
    }
    return { ...result, ...((result.status === "completed" || result.status === "follow_up") && retainedCandidatePlan ? { publicPlanPresentation: retainedCandidatePlan.presentation } : {}),
      ...((result.status === "completed" || result.status === "follow_up") && tripCostProposal ? { tripCostProposal } : {}), ...((result.status === "completed" || result.status === "follow_up") && tripUpdateProposal ? { tripUpdateProposal } : {}),
      ...((result.status === "completed" || result.status === "follow_up") && consultationRequestProposal ? { consultationRequestProposal } : {}) };
  } };
}
