import type { ConversationSession } from "../../domain/conversation-session";
import type { ConversationSessionRepository } from "./conversation-session-repository";

export interface ConversationSessionView {
  switchSession(sessionId: string): void;
}

export interface ConversationSessionSwitcher {
  activate(sessionId: string): ConversationSession | undefined;
}

export function createConversationSessionSwitcher(options: {
  repository: ConversationSessionRepository;
  conversation: ConversationSessionView;
  tripPlan: ConversationSessionView;
  onActivated: (session: ConversationSession) => void;
}): ConversationSessionSwitcher {
  return {
    activate(sessionId) {
      const session = options.repository.active()?.id === sessionId
        ? options.repository.active()
        : options.repository.select(sessionId);
      if (!session) return undefined;

      options.onActivated(session);
      options.tripPlan.switchSession(session.id);
      options.conversation.switchSession(session.id);
      return session;
    },
  };
}
