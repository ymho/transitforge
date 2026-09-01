import type { TripContext } from "@raiquora/trip/travel-profile";

/**
 * A small, UI-neutral contract for one turn in a travel consultation.
 *
 * The assistant owns which question comes next. The presentation layer only
 * renders the question and returns the selected or typed answer.
 */
export type ConversationExpectedInput =
  | "planning-intent"
  | "departure-date"
  | "stay-length"
  | "traveler-count"
  | "free-text";

export interface ConversationQuickReply {
  label: string;
  value: string;
}

export interface ConversationGuidance {
  recommendation?: string;
  reason?: string;
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
    ...(guidance.recommendation?.trim()
      ? { recommendation: guidance.recommendation.trim() }
      : { recommendation: undefined }),
    ...(guidance.reason?.trim() ? { reason: guidance.reason.trim() } : { reason: undefined }),
    question: guidance.question.trim(),
    quickReplies: guidance.quickReplies
      .map((reply) => ({ label: reply.label.trim(), value: reply.value.trim() }))
      .filter((reply) => reply.label.length > 0 && reply.value.length > 0)
      .filter((reply, index, replies) =>
        replies.findIndex((candidate) => candidate.value === reply.value) === index)
      .slice(0, 5),
  };
}
