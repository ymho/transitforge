export type ConversationScope = "trip";

export interface ConversationSession {
  id: string;
  title: string;
  scope: "trip";
  /** Missing only for the unsent in-memory Hero placeholder; persisted sessions always have one. */
  tripId?: string;
  summary: string;
  resolvedTopics: string[];
  pendingTopics: string[];
  createdAt: string;
  updatedAt: string;
}
