import type {
  ConversationScope,
  ConversationSession,
} from "../../domain/conversation-session";

export interface ConversationSessionRepository {
  list(): ConversationSession[];
  active(): ConversationSession | undefined;
  create(scope?: ConversationScope, title?: string): ConversationSession;
  select(sessionId: string): ConversationSession | undefined;
  rename(sessionId: string, title: string): ConversationSession | undefined;
  save(session: ConversationSession): ConversationSession;
  delete(sessionId: string): ConversationSession;
  subscribe(listener: () => void): () => void;
}
