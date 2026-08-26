import type { ViewerAgentResponse } from "../../domain/viewer-agent-response";

export type ConversationMessage =
  | { messageId: string; role: "user"; text: string }
  | {
    messageId: string;
    role: "assistant";
    response: ViewerAgentResponse;
    requestId?: string;
  };

export type NewConversationMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; response: ViewerAgentResponse; requestId?: string };

export interface ConversationHistoryRepository {
  list(sessionId: string): ConversationMessage[];
  append(sessionId: string, message: NewConversationMessage): ConversationMessage;
  delete(sessionId: string): void;
}
