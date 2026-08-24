import type { TripContext } from "./travel-profile";

/**
 * A small, UI-neutral contract for one turn in a travel consultation.
 *
 * The assistant owns which question comes next. The presentation layer only
 * renders the question and returns the selected or typed answer.
 */
export type ConversationExpectedInput =
  | "departure-date"
  | "stay-length"
  | "traveler-count"
  | "free-text";

export interface ConversationQuickReply {
  label: string;
  value: string;
}

export interface ConversationGuidance {
  question: string;
  expectedInput: ConversationExpectedInput;
  quickReplies: ConversationQuickReply[];
  tripContext: TripContext;
}

export interface ConversationSubmission {
  answer: string;
  guidance: ConversationGuidance;
}

export function normalizedConversationGuidance(
  guidance: ConversationGuidance,
): ConversationGuidance {
  return {
    ...guidance,
    question: guidance.question.trim(),
    quickReplies: guidance.quickReplies
      .map((reply) => ({ label: reply.label.trim(), value: reply.value.trim() }))
      .filter((reply) => reply.label.length > 0 && reply.value.length > 0)
      .filter((reply, index, replies) =>
        replies.findIndex((candidate) => candidate.value === reply.value) === index)
      .slice(0, 5),
  };
}

/** Keep the contextual instruction out of the UI while preserving the user's answer. */
export function promptWithConversationContext(
  prompt: string,
  submission?: ConversationSubmission,
): string {
  if (!submission) return prompt;
  const guidance = normalizedConversationGuidance(submission.guidance);
  return [
    "旅行相談の会話を継続しています。",
    `現在の旅行条件: ${JSON.stringify(guidance.tripContext)}`,
    `直前の質問: ${guidance.question}`,
    `回答の種類: ${guidance.expectedInput}`,
    `利用者の今回の回答: ${prompt}`,
  ].join("\n");
}
