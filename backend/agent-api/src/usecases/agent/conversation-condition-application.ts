import { admitConditionChange, ConditionUpdateRejectedError, type ConversationConditionChange } from "@raiquora/agent/conversation-condition";
import type { ConversationConditionRepository } from "../../ports/conversation-condition-repository.js";
import type { ConversationTurnIdentity, ConversationTurnLease } from "../../ports/conversation-turn-repository.js";
import { requireStatePrincipal, stateId, StateError } from "../../contracts/server-state.js";

/** One shared business writer behind the small condition Tools. It cannot update a
 * Profile, Trip, reservation or payment; only this authenticated Conversation turn. */
export function createConversationConditionApplication(repository: ConversationConditionRepository,
  identity: ConversationTurnIdentity, lease: ConversationTurnLease, userMessage: string) {
  requireStatePrincipal(identity.principal); stateId(identity.conversationId); stateId(identity.turnId);
  const scope = structuredClone(identity), executionLease = structuredClone(lease);
  return async (value: ConversationConditionChange) => {
    const change = admitConditionChange(value, userMessage);
    try { return await repository.acceptCondition(scope, executionLease, change); }
    catch (error) {
      if (error instanceof StateError && error.code === "conflict") throw new ConditionUpdateRejectedError("condition_conflict");
      throw error; // Unknown/ambiguous persistence failures must stop publication.
    }
  };
}
