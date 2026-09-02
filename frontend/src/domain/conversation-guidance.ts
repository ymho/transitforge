import type { TripContext } from "@raiquora/trip/travel-profile";

export const conversationExpectedInputs = [
  "planning-intent",
  "departure-date",
  "stay-length",
  "traveler-count",
  "free-text",
] as const;

/**
 * A small, UI-neutral contract for one turn in a travel consultation.
 *
 * The assistant owns which question comes next. The presentation layer only
 * renders the question and returns the selected or typed answer.
 */
export type ConversationExpectedInput = typeof conversationExpectedInputs[number];

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

export const maximumConversationQuickReplies = 3;

const conversationExpectedInputSet = new Set<string>(conversationExpectedInputs);

export function isConversationExpectedInput(
  value: unknown,
): value is ConversationExpectedInput {
  return typeof value === "string" && conversationExpectedInputSet.has(value);
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
      .slice(0, maximumConversationQuickReplies),
  };
}

export function conversationTextIsQuestion(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return false;
  return /[?？]\s*$/u.test(normalized) ||
    /(?:教えて|選んで|答えて)(?:ください|もらえますか)|(?:ですか|ますか)\s*[。.]?$/u.test(normalized);
}

export function conversationQuestionWasAsked(
  question: string,
  recentAssistantMessages: readonly string[],
): boolean {
  const target = comparableQuestion(question);
  return target.length >= 6 && recentAssistantMessages.some((message) =>
    comparableQuestion(message).includes(target));
}

function comparableQuestion(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP")
    .replace(/[\s　、,。.!！?？・･「」『』（）()]/gu, "");
}
