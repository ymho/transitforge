import type { TrustedPrincipal } from "../contracts/trusted-principal.js";
import type { Conversation, ConversationMetadata, ConversationMessage, MessageInput, PageOptions, StatePage } from "../contracts/server-state.js";

export interface ConversationRepository {
  create(principal: TrustedPrincipal, conversationId: string, metadata: ConversationMetadata): Promise<Conversation>;
  get(principal: TrustedPrincipal, conversationId: string): Promise<Conversation | undefined>;
  list(principal: TrustedPrincipal, options?: PageOptions): Promise<StatePage<Conversation>>;
  history(principal: TrustedPrincipal, conversationId: string, options?: PageOptions): Promise<StatePage<ConversationMessage>>;
  append(principal: TrustedPrincipal, conversationId: string, expectedRevision: number, messages: MessageInput[]): Promise<Conversation>;
  update(principal: TrustedPrincipal, conversationId: string, expectedRevision: number, metadata: ConversationMetadata): Promise<Conversation>;
  /** Retry with the same revision until complete. First call atomically hides the conversation. */
  delete(principal: TrustedPrincipal, conversationId: string, expectedRevision: number): Promise<{ complete: boolean }>;
}
