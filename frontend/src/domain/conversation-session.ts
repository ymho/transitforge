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

export function createConversationSession(tripId: string, now = new Date()): ConversationSession {
  if (!uuid.test(tripId)) throw new Error("Invalid Trip reference");
  const timestamp = now.toISOString();
  return { id: crypto.randomUUID(), title: "新しい旅", scope: "trip", tripId, summary: "", resolvedTopics: [], pendingTopics: [], createdAt: timestamp, updatedAt: timestamp };
}

export function parseConversationSession(value: unknown): ConversationSession | undefined {
  const item = value as Partial<ConversationSession>;
  if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.title !== "string" ||
    item.scope !== "trip" || typeof item.tripId !== "string" || !uuid.test(item.tripId) || typeof item.summary !== "string" ||
    !Array.isArray(item.resolvedTopics) || !item.resolvedTopics.every((topic) => typeof topic === "string") ||
    !Array.isArray(item.pendingTopics) || !item.pendingTopics.every((topic) => typeof topic === "string") ||
    typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") return undefined;
  return structuredClone(item as ConversationSession);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
