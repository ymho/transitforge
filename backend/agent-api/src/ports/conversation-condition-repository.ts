import type { ConversationConditionChange } from "@raiquora/agent/conversation-condition";
import type { IntentApplicationReceipt } from "@raiquora/agent/conversation-intent-reducer";
import type { ConversationTurnIdentity, ConversationTurnLease } from "./conversation-turn-repository.js";

/** The repository atomically records an operation receipt together with the accepted
 * Conversation overlay. The turn identity/lease is Application-owned, never Tool input. */
export interface ConversationConditionRepository {
  acceptCondition(identity: ConversationTurnIdentity, lease: ConversationTurnLease,
    change: ConversationConditionChange): Promise<IntentApplicationReceipt>;
}
