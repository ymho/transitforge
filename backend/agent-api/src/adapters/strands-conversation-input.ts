import type { MessageData } from "@strands-agents/sdk";
import { strandsTurnInput, StrandsTurnInputError } from "./strands-turn-input.js";

/** Keep owned, published dialogue in SDK-native roles, separate from the current
 * Application snapshot. The existing serializer validates/filter/bounds the whole
 * input before splitting; no summarization, extra state store or history repair. */
export function strandsConversationInput(input: Parameters<typeof strandsTurnInput>[0]): {
  modelInput: string; messages: MessageData[];
} {
  const data = JSON.parse(strandsTurnInput(input));
  const conversation = data.application.conversation;
  const messages: MessageData[] = [];
  if (conversation?.messages !== undefined) {
    if (!Array.isArray(conversation.messages)) throw new StrandsTurnInputError("invalid_input");
    for (const message of conversation.messages) {
      if (!message || !["user", "assistant"].includes(message.role) || typeof message.text !== "string" || !message.text.trim()) {
        throw new StrandsTurnInputError("invalid_input");
      }
      // Do not resurrect model Tool calls/results, arbitrary roles or attachments
      // from a history record. Public text is not an executable SDK instruction.
      messages.push({ role: message.role, content: [{ text: message.text }] });
    }
    delete conversation.messages;
  }
  return { modelInput: JSON.stringify(data), messages };
}
