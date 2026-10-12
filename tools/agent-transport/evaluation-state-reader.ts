import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";
import { DynamoStateStore, type StateDynamoClient } from "../../backend/agent-api/src/adapters/dynamodb-state-store.js";
import { DynamoDbConversationTurnRepository } from "../../backend/agent-api/src/adapters/dynamodb-conversation-turn-repository.js";
import { DynamoDbItineraryCandidateRepository } from "../../backend/agent-api/src/adapters/dynamodb-itinerary-candidate-repository.js";
import { parseConditionJournal } from "@raiquora/agent/conversation-condition";

export interface EvaluationStateTarget { tripId: string; conversationId: string; turnId?: string }

/** Private IAM read path, never an HTTP route. A process-fixed verified test
 * identity plus exact target keys prevents scan, mutation and arbitrary owner reads. */
export function createEvaluationStateReader(config: { issuer: string; subject: string; stateTable: string; tripTable: string },
  sdk: Pick<DynamoDBClient, "send"> = new DynamoDBClient({ region: "ap-northeast-1" }), signal?: AbortSignal) {
  if (!config.stateTable || !config.tripTable || !config.subject) throw new Error("invalid_evaluation_state_config");
  const principal = { subject: "identity-v1:" + createHash("sha256").update(JSON.stringify([config.issuer, config.subject])).digest("hex"),
    identity: { issuer: config.issuer, subject: config.subject }, scopes: ["raiquora/user"] };
  return async (target: EvaluationStateTarget) => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
    if (![target.tripId, target.conversationId].every(value => uuid.test(value)) || target.tripId !== target.conversationId ||
      target.turnId !== undefined && !uuid.test(target.turnId)) throw new Error("invalid_evaluation_state_target");
    const allowed = new Set([`${config.stateTable}/TRIP_WORKING#${target.conversationId}`,
      ...(target.turnId ? [`${config.stateTable}/TRIP_TURN#${target.conversationId}#${target.turnId}`] : [])]);
    const client: StateDynamoClient = { async send(command) {
      if (!(command instanceof GetItemCommand) || command.input.Key?.pk?.S !== `OWNER#${principal.subject}` ||
        !allowed.has(`${command.input.TableName}/${command.input.Key?.sk?.S}`) || command.input.ConsistentRead !== true) throw new Error("evaluation_read_denied");
      return sdk.send(command, { abortSignal: signal });
    } };
    const repository = new DynamoDbConversationTurnRepository(config.stateTable, client);
    const working = await repository.getWorkingState(principal, target.conversationId);
    if (working && working.target.tripId !== undefined && working.target.tripId !== target.tripId) throw new Error("evaluation_read_denied");
    const refs = working?.presentations.flatMap(item => item.candidateSetRef?.kind === "candidate-set-ref" ? [item.candidateSetRef] : []) ?? [];
    const unique = [...new Map(refs.map(ref => [`${ref.candidateSetId}#${ref.revision}`, ref])).values()].slice(0, 20);
    const candidates = [];
    const candidateRepository = new DynamoDbItineraryCandidateRepository(config.tripTable, client);
    for (const ref of unique) {
      allowed.add(`${config.tripTable}/CANDIDATE#${target.conversationId}#${ref.candidateSetId}#${ref.revision}`);
      const candidate = await candidateRepository.get(principal, target.conversationId, ref.candidateSetId, ref.revision);
      if (candidate && candidate.contextRef.tripId !== target.tripId) throw new Error("evaluation_read_denied");
      candidates.push(candidate ? { id: candidate.id, revision: candidate.revision, baseTripRevision: candidate.contextRef.baseTripRevision,
        expiresAt: candidate.expiresAt, variants: candidate.variants.map(variant => ({ id: variant.id, comparisonOnly: !!variant.comparisonOnly,
          items: variant.items.map(item => ({ componentId: item.componentId, kind: item.kind, schedule: item.schedule,
            plannedTiming: item.plannedTiming, baseItemId: item.baseItemId, sourceCandidateRef: item.sourceCandidateRef })),
          removedBaseItemIds: variant.removedBaseItemIds, retainedBaseItemIds: variant.retainedBaseItemIds })) } : { id: ref.candidateSetId, unavailable: true });
    }
    const turn = target.turnId ? await new DynamoStateStore(config.stateTable, client).read(principal, `TRIP_TURN#${target.conversationId}#${target.turnId}`) : undefined;
    const record = turn?.payload as { state?: unknown; userSequence?: unknown; conditionUpdates?: unknown } | undefined;
    const journal = record?.conditionUpdates ? parseConditionJournal(record.conditionUpdates, target.turnId!) : undefined;
    return {
      working: working ? { revision: working.revision, target: working.target, sourceUserSequence: working.sourceUserSequence,
        pendingQuestionRefs: working.pendingQuestionRefs, pendingProposalRefs: working.pendingProposalRefs, presentations: working.presentations,
        semantic: working.semantic ? { overlay: working.semantic.overlay,
          receiptRevisions: working.semantic.receipts.map(receipt => receipt.intentRevision),
          pendingProposal: working.semantic.pendingProposal, adoptionInFlight: working.semantic.adoptionInFlight,
          adoptions: working.semantic.adoptions } : undefined } : undefined,
      turn: record ? { state: ["started", "intent_accepted", "failed", "completed"].includes(String(record.state)) ? record.state : "unknown",
        userSequence: Number.isSafeInteger(record.userSequence) ? record.userSequence : undefined,
        conditions: journal?.operations.map(operation => ({ target: operation.target, intentRevision: operation.receipt.intentRevision,
          operations: operation.receipt.operations.map(item => ({ target: item.target, status: item.status })) })) } : undefined,
      candidates,
    };
  };
}
