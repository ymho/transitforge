import type {
  ConversationHistoryRepository,
  ConversationMessage,
  NewConversationMessage,
} from "../../application/concierge/conversation-history-repository";
import {
  appendConversationHistory,
  deleteConversationHistory,
  loadConversationHistory,
} from "../../domain/conversation-history";

type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

export class LocalConversationHistoryRepository
implements ConversationHistoryRepository {
  constructor(
    private readonly storage: HistoryStorage,
    private readonly createMessageId: () => string = () => crypto.randomUUID(),
  ) {}

  list(sessionId: string): ConversationMessage[] {
    return loadConversationHistory(this.storage, sessionId);
  }

  append(
    sessionId: string,
    message: NewConversationMessage,
  ): ConversationMessage {
    const stored = { ...message, messageId: this.createMessageId() } as ConversationMessage;
    appendConversationHistory(this.storage, sessionId, stored);
    return stored;
  }

  delete(sessionId: string): void {
    deleteConversationHistory(this.storage, sessionId);
  }
}
