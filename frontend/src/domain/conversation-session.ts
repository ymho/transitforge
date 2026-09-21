import { parseConsultationRequest } from "@raiquora/trip/consultation-request";
export type ConversationScope = "general" | "trip" | "place" | "route";

export interface ConversationSession {
  id: string;
  title: string;
  scope: ConversationScope;
  tripId?: string;
  draftRequest?: import("@raiquora/trip/trip-request").TripRequest;
  summary: string;
  resolvedTopics: string[];
  pendingTopics: string[];
  createdAt: string;
  updatedAt: string;
}

export function createConversationSession(scope: ConversationScope = "general", now = new Date()): ConversationSession {
  const timestamp = now.toISOString();
  return { id: crypto.randomUUID(), title: "新しい会話", scope, summary: "", resolvedTopics: [], pendingTopics: [], createdAt: timestamp, updatedAt: timestamp };
}

export function parseConversationSession(value: unknown): ConversationSession | undefined {
  const item = value as Partial<ConversationSession>;
  if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.title !== "string" ||
    !["general", "trip", "place", "route"].includes(item.scope ?? "") || typeof item.summary !== "string" ||
    !Array.isArray(item.resolvedTopics) || !item.resolvedTopics.every((topic) => typeof topic === "string") ||
    !Array.isArray(item.pendingTopics) || !item.pendingTopics.every((topic) => typeof topic === "string") ||
    typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
    item.tripId !== undefined && (typeof item.tripId !== "string" || !uuid.test(item.tripId))) return undefined;
  try { if (item.draftRequest !== undefined) { if (item.tripId) return undefined; parseConsultationRequest(item.draftRequest); } } catch { return undefined; }
  return structuredClone(item as ConversationSession);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
