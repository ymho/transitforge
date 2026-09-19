/** Temporary shape used only by the still-local Trip migration seam. */
export type ConversationScope = "general" | "trip" | "place" | "route";

export interface ConversationSession {
  id: string;
  title: string;
  scope: ConversationScope;
  tripPlanId?: string;
  tripId?: string;
  tripSourceState?: "server-v2" | "migration-pending";
  summary: string;
  resolvedTopics: string[];
  pendingTopics: string[];
  createdAt: string;
  updatedAt: string;
}

export function createConversationSession(scope: ConversationScope = "general", tripPlanId?: string, now = new Date()): ConversationSession {
  const timestamp = now.toISOString();
  return { id: crypto.randomUUID(), title: "新しい会話", scope, ...(tripPlanId ? { tripPlanId } : {}), summary: "", resolvedTopics: [], pendingTopics: [], createdAt: timestamp, updatedAt: timestamp };
}

export function parseConversationSession(value: unknown): ConversationSession | undefined {
  const item = value as Partial<ConversationSession>;
  if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.title !== "string" ||
    !["general", "trip", "place", "route"].includes(item.scope ?? "") || typeof item.summary !== "string" ||
    !Array.isArray(item.resolvedTopics) || !item.resolvedTopics.every((topic) => typeof topic === "string") ||
    !Array.isArray(item.pendingTopics) || !item.pendingTopics.every((topic) => typeof topic === "string") ||
    typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
    [item.tripPlanId, item.tripId].some((id) => id !== undefined && (typeof id !== "string" || !uuid.test(id))) ||
    item.tripSourceState !== undefined && item.tripSourceState !== "server-v2" && item.tripSourceState !== "migration-pending") return undefined;
  return structuredClone(item as ConversationSession);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
