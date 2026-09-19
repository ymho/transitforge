export type ServerConversationScope = "general" | "trip" | "place" | "route";
export interface ServerConversationMetadata { title: string; scope: ServerConversationScope; summary: string; resolvedTopics: string[]; pendingTopics: string[]; tripId?: string }
export interface ServerConversation extends ServerConversationMetadata { conversationId: string; createdAt: string; updatedAt: string; revision: number; messageCount: number }
export interface ServerConversationMessage { role: "user" | "assistant"; text: string; sequence: number; createdAt: string }
export interface ServerPage<T> { items: T[]; nextAfter?: string }
/** Authenticated transport port. It deliberately does not replace the legacy browser repositories yet. */
export interface ServerConversationClient {
  create(metadata: ServerConversationMetadata): Promise<ServerConversation>;
  get(conversationId: string): Promise<ServerConversation | undefined>;
  list(page?: { limit?: number; after?: string }): Promise<ServerPage<ServerConversation>>;
  history(conversationId: string, page?: { limit?: number; after?: string }): Promise<ServerPage<ServerConversationMessage>>;
  update(conversationId: string, expectedRevision: number, metadata: ServerConversationMetadata): Promise<ServerConversation>;
  delete(conversationId: string, expectedRevision: number): Promise<{ complete: boolean }>;
}
