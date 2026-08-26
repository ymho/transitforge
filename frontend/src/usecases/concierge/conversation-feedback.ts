import type { ConversationMessage } from "./conversation-history-repository";

export interface ConversationFeedbackV2 {
  schemaVersion: "conversation-feedback-v2";
  rating: "good" | "bad";
  comment?: string;
  sessionId: string;
  targetMessageId: string;
  requestIds: string[];
  conversation: Array<{
    messageId: string;
    role: "user" | "assistant";
    text: string;
    requestId?: string;
  }>;
}

export function buildConversationFeedback(
  sessionId: string,
  messages: ConversationMessage[],
  targetMessageId: string,
  rating: "good" | "bad",
  comment?: string,
): ConversationFeedbackV2 {
  const targetIndex = messages.findIndex(({ messageId }) =>
    messageId === targetMessageId);
  if (targetIndex < 0 || messages[targetIndex].role !== "assistant") {
    throw new Error("評価対象の回答が会話履歴にありません");
  }
  const conversation = messages.slice(0, targetIndex + 1).map((message) =>
    message.role === "user"
      ? { messageId: message.messageId, role: message.role, text: message.text }
      : {
        messageId: message.messageId,
        role: message.role,
        text: responseText(message.response),
        ...(message.requestId ? { requestId: message.requestId } : {}),
      });
  return {
    schemaVersion: "conversation-feedback-v2",
    rating,
    ...(comment?.trim() ? { comment: comment.trim() } : {}),
    sessionId,
    targetMessageId,
    requestIds: [...new Set(conversation.flatMap((message) =>
      "requestId" in message && message.requestId ? [message.requestId] : []))],
    conversation,
  };
}

function responseText(
  response: Extract<ConversationMessage, { role: "assistant" }>["response"],
): string {
  return typeof response === "string" ? response : response.text;
}
