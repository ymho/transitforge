import { searchSelectionDraft } from "../usecases/retain-search-selection.js";
import { createPresentedCandidateController, type CandidatePresentation } from "../usecases/agent/presented-candidate-selection.js";
import { PlanCandidateAdoptionApplication } from "../usecases/plan-candidate-adoption.js";
import { TripApplication } from "../usecases/trip-application.js";
import { ReservationApplication } from "../usecases/reservation-application.js";
import { DynamoDbReservationRepository } from "../adapters/dynamodb-reservation-repository.js";
import { trustedCandidateItem } from "../usecases/retained-candidate-item.js";
import type { ConversationMessage } from "../contracts/server-state.js";
import { withMeasuredResearchOutcome } from "@raiquora/agent/public-plan-presentation";
import { registerCostProposalTool } from "../usecases/agent/cost-proposal-tool.js";
import type { PublicCostProposal } from "@raiquora/trip/public-cost-proposal";
import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import { parsePublicRequestProposal } from "@raiquora/trip/public-request-proposal";
import type { ServerAgentTurn } from "../usecases/agent/server-agent.js";
import type { AgentProgressReporter } from "@raiquora/agent/agent-progress";
import { registerRequestProposalTool } from "../usecases/agent/request-proposal-tool.js";
import { registerTripItemProposalTool } from "../usecases/agent/trip-item-proposal-tool.js";
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
import { registerTripSearchContextTool } from "../usecases/agent/trip-search-context-tool.js";
import { tripGapRestaurantTool } from "../usecases/agent/trip-gap-restaurant-tool.js";
import { tripGapPlaceTool } from "../usecases/agent/trip-gap-place-tool.js";
import { tripGapGroundRouteTool } from "../usecases/agent/trip-gap-ground-route-tool.js";
import type { GroundRouteProvider } from "../ports/ground-route-provider.js";
import { registerServerTools } from "../usecases/agent/server-tools.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import { DynamoDbItineraryCandidateRepository } from "../adapters/dynamodb-itinerary-candidate-repository.js";
import { knownItineraryDayCount, PlanCandidateRetentionApplication, registerPlanCandidateRetentionTool, type RetainedCandidatePlan } from "../usecases/plan-candidate-retention.js";
import { proposeVerifiedIntentRequest } from "@raiquora/agent/verified-intent-proposal";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import type { IntentApplicationReceipt } from "@raiquora/agent/conversation-intent-reducer";
import { publicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
import type { ConversationConditionInput } from "@raiquora/agent/conversation-condition";

/** Internal stateful composition. Transport/auth rollout and env bindings remain with #451/#462/#480. */
export function createStatefulServerAgent(options: Omit<Parameters<typeof createServerAgent>[0], "loadContext"> & {
  /** Trusted composition option for persisted turns; excludes the current input from history. */
  historyBeforeSequence?: number;
  stateTable: string;
  tripTable: string;
  stateClient?: StateDynamoClient;
  tripClient?: TripDynamoClient;
  searchTripRestaurants?: AgentOperation;
  searchTripPlaces?: AgentOperation;
  tripGroundRoutes?: GroundRouteProvider;
  verifiedSearchSelectionItems?: (result: import("@raiquora/agent/runtime-contract").AgentRuntimeResult) => readonly import("@raiquora/trip/trip").ItineraryItem[];
  onGroundRouteEvidence?: (evidenceId: string, output: Record<string, unknown>) => void;
}) {
  return { async runAgentTurn(input: ServerAgentTurn, reportProgress?: AgentProgressReporter,
    acceptCondition?: (change: ConversationConditionInput) => Promise<IntentApplicationReceipt>) {
    let tripCostProposal: PublicCostProposal | undefined, retainedCandidatePlan: RetainedCandidatePlan | undefined;
    let trip: Trip | undefined, tripUpdateProposal: TripUpdateProposal | undefined;
    let effectiveIntent: EffectiveIntent | undefined, currentIntentReceipt: IntentApplicationReceipt | undefined;
    let turnExecutionId: string | undefined;
    let previousMessages: ConversationMessage[] = [], shown: CandidatePresentation | undefined;
    const tripRepository = new DynamoDbTripRepository(options.tripTable, options.tripClient);
    const candidateRepository = new DynamoDbItineraryCandidateRepository(options.tripTable, options.tripClient);
    const tripApplication = new TripApplication(tripRepository, tripRepository, undefined,
      new ReservationApplication(tripRepository, new DynamoDbReservationRepository(options.tripTable, options.tripClient)));
    const adoption = new PlanCandidateAdoptionApplication(candidateRepository, tripRepository, candidateRepository, tripApplication,
      (draft, context) => trustedCandidateItem(draft, context.candidateSetId, context.variantId, context.retainedItem, context.selectedAt));
    const turnStates = new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient);
    const contextLoader = createServerStateContextLoader({
      conversations: new ConversationApplication(new DynamoDbConversationRepository(options.stateTable, options.stateClient),
        new DynamoDbItineraryCandidateRepository(options.tripTable, options.tripClient)),
      profiles: new ProfileApplication(new DynamoDbProfileRepository(options.stateTable, options.stateClient)),
      trips: new DynamoDbTripRepository(options.tripTable, options.tripClient),
      workingStates: turnStates,
    }, { historyBeforeSequence: options.historyBeforeSequence, onConversationMessages: messages => { previousMessages = messages; }, onTrip: value => { trip = value; },
      onEffectiveIntent: value => { effectiveIntent = value.effectiveIntent; currentIntentReceipt = value.currentReceipt; } });
    const runtime = options.runRuntime;
    const runRuntime = runtime ? async (runtimeInput: Parameters<typeof runtime>[0]) => {
      turnExecutionId = runtimeInput.executionId;
      return runtime({
        ...runtimeInput,
        ...(trip && input.conversationId && options.historyBeforeSequence ? { candidateController: createPresentedCandidateController({
          messages: previousMessages, trip, conversationId: input.conversationId, userSequence: options.historyBeforeSequence,
          executionId: runtimeInput.executionId, userRequest: input.userRequest,
          adoptPlan: (request, authority) => adoption.execute(input.principal, request, authority),
          show: presentation => { shown = presentation; },
        }) } : {}),
        ...(acceptCondition ? { conditionController: {
          apply: async (change: ConversationConditionInput) => {
            const receipt = await acceptCondition(change);
            const refreshed = await contextLoader({
              principal: input.principal,
              ...(input.conversationId ? { conversationId: input.conversationId } : {}),
              ...(input.tripId ? { tripId: input.tripId } : {}),
              ...(input.uiContext ? { uiContext: input.uiContext } : {}),
            });
            if (!refreshed.effectiveIntent) throw new Error("Accepted intent requires a refreshed Application snapshot");
            return { receipt: publicSemanticReceipt(receipt), effectiveIntent: refreshed.effectiveIntent };
          },
        } } : {}),
      });
    } : undefined;
    const result = await createServerAgent({ ...options,
      registerAdditionalTools: (tools, evidence, scope) => {
        turnExecutionId = scope.executionId;
        options.registerAdditionalTools?.(tools, evidence, scope);
        if (trip) {
          registerTripReadTools(tools, evidence, trip);
          registerTripSearchContextTool(tools, evidence, trip);
          if (options.searchTripRestaurants) registerServerTools(tools, evidence, [tripGapRestaurantTool(trip, options.searchTripRestaurants, options.weather)]);
          if (options.searchTripPlaces) registerServerTools(tools, evidence, [tripGapPlaceTool(trip, options.searchTripPlaces, options.weather)]);
          if (options.tripGroundRoutes) registerServerTools(tools, evidence, [tripGapGroundRouteTool(trip, options.tripGroundRoutes, options.onGroundRouteEvidence)]);
          registerRequestProposalTool(tools, trip, proposal => { tripUpdateProposal = proposal; });
          registerTripItemProposalTool(tools, trip, proposal => { tripUpdateProposal = proposal; });
          registerCostProposalTool(tools, trip, proposal => { tripCostProposal = proposal; });
          if (scope.conversationId) {
            const candidateRepository = new DynamoDbItineraryCandidateRepository(options.tripTable, options.tripClient);
            registerPlanCandidateRetentionTool(tools, new PlanCandidateRetentionApplication(candidateRepository), () => ({
              principal: scope.principal, executionId: scope.executionId, conversationId: scope.conversationId!, userRequest: scope.userRequest,
              // Request-only condition adoption is the next atomic revision.
              // The candidate is published only after that adoption succeeds.
              tripId: trip!.id, baseTripRevision: trip!.revision + (effectiveIntent && currentIntentReceipt &&
                proposeVerifiedIntentRequest({ conversationId: scope.conversationId!, trip: trip!, effectiveIntent, receipt: currentIntentReceipt }) ? 1 : 0),
              baseItemIds: trip!.items.map(item => item.id),
              baseDayIds: trip!.timeline?.logicalDays.map(day => day.id),
            }), value => { retainedCandidatePlan = value; }, () => knownItineraryDayCount(effectiveIntent));
          }
        }
      },
      // Restored private state may be echoed in any later turn block. Do not retain raw model-call traces.
      // Runtime metadata/latency diagnostics remain available; no Bedrock/provider implementation change.
      model: { converse: ({ trace: _trace, ...request }) => options.model.converse(request) },
      loadContext: contextLoader,
      ...(runRuntime ? { runRuntime } : {}),
    }).runAgentTurn(input, reportProgress);
    if (input.conversationId && effectiveIntent && currentIntentReceipt && trip) {
      const verified = proposeVerifiedIntentRequest({ conversationId: input.conversationId, trip, effectiveIntent, receipt: currentIntentReceipt });
      if (verified) tripUpdateProposal = parsePublicRequestProposal(verified);
    }
    if (!retainedCandidatePlan && trip && input.conversationId && options.verifiedSearchSelectionItems && result.status === "completed") {
      const selectionItems = options.verifiedSearchSelectionItems(result);
      const draft = searchSelectionDraft(selectionItems, trip, input.uiContext?.itemId);
      if (draft) retainedCandidatePlan = await new PlanCandidateRetentionApplication(candidateRepository).retain({
        principal: input.principal, executionId: turnExecutionId!, conversationId: input.conversationId,
        userRequest: input.userRequest, tripId: trip.id, baseTripRevision: trip.revision + (tripUpdateProposal?.patches.every(patch => patch.type === "request") ? 1 : 0),
      }, draft, []);
    }
    if (retainedCandidatePlan && result.researchExecution) {
      const { usage, requestedMode, effectiveMode } = result.researchExecution;
      retainedCandidatePlan = { ...retainedCandidatePlan, presentation: withMeasuredResearchOutcome(retainedCandidatePlan.presentation,
        { modelCalls: usage.modelCalls, toolCalls: usage.toolCalls, wallClockMs: usage.wallClockMs, requestedMode, effectiveMode }) };
    }
    return { ...result, ...(shown && (result.status === "completed" || result.status === "follow_up") ? shown : {}), ...((result.status === "completed" || result.status === "follow_up") && retainedCandidatePlan ? { publicPlanPresentation: retainedCandidatePlan.presentation } : {}),
      ...((result.status === "completed" || result.status === "follow_up") && tripCostProposal ? { tripCostProposal } : {}), ...((result.status === "completed" || result.status === "follow_up") && tripUpdateProposal ? { tripUpdateProposal } : {}) };
  } };
}
