import type { ViewerAgentResponse } from "./viewer-agent-response";

export const conversationHistoryStorageKey = "transitforge.concierge-history.v1";
const maximumEntries = 50;

export type ConversationHistoryEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; response: ViewerAgentResponse };

export function loadConversationHistory(
  storage: Pick<Storage, "getItem">,
): ConversationHistoryEntry[] {
  try {
    const raw = storage.getItem(conversationHistoryStorageKey);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isHistoryEntry).slice(-maximumEntries) : [];
  } catch {
    return [];
  }
}

export function appendConversationHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
  entry: ConversationHistoryEntry,
): void {
  storage.setItem(
    conversationHistoryStorageKey,
    JSON.stringify([...loadConversationHistory(storage), entry].slice(-maximumEntries)),
  );
}

function isHistoryEntry(value: unknown): value is ConversationHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return entry.role === "user" && typeof entry.text === "string" ||
    entry.role === "assistant" && "response" in entry;
}
