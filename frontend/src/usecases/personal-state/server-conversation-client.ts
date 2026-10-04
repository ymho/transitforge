import type { AssistantTurnArtifacts } from "../../domain/assistant-turn-view";

export type ServerConversationScope = "trip";
export interface ServerConversationMetadata { title: string; scope: ServerConversationScope; summary: string; resolvedTopics: string[]; pendingTopics: string[]; tripId: string }
export interface ServerConversation extends ServerConversationMetadata { conversationId: string; createdAt: string; updatedAt: string; revision: number; messageCount: number }
export interface ServerConversationMessage extends AssistantTurnArtifacts { role: "user" | "assistant"; text: string; sequence: number; createdAt: string }
export interface ServerPage<T> { items: T[]; nextAfter?: string }
/** Authenticated Server Conversation transport. Browser history is an account-scoped read model. */
export interface ServerConversationClient {
  create(metadata: ServerConversationMetadata): Promise<ServerConversation>;
  get(conversationId: string): Promise<ServerConversation | undefined>;
  list(page?: { limit?: number; after?: string }): Promise<ServerPage<ServerConversation>>;
  history(conversationId: string, page?: { limit?: number; after?: string }): Promise<ServerPage<ServerConversationMessage>>;
  update(conversationId: string, expectedRevision: number, metadata: ServerConversationMetadata): Promise<ServerConversation>;
  delete(conversationId: string, expectedRevision: number): Promise<{ complete: boolean }>;
}
