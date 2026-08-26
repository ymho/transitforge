import type { ViewerAgentResponse } from "./viewer-agent-response";

export const conversationHistoryStorageKey = "transitforge.concierge-history.v3";
const previousConversationHistoryStorageKey = "transitforge.concierge-history.v2";
const legacyConversationHistoryStorageKey = "transitforge.concierge-history.v1";
const maximumEntriesPerSession = 50;
const maximumSessions = 20;

export type ConversationHistoryEntry =
  | { messageId: string; role: "user"; text: string }
  | { messageId: string; role: "assistant"; response: ViewerAgentResponse; requestId?: string };

interface StoredConversationHistory {
  version: 3;
  sessions: Record<string, ConversationHistoryEntry[]>;
}

export function loadConversationHistory(
  storage: Pick<Storage, "getItem">,
  sessionId: string,
): ConversationHistoryEntry[] {
  const stored = readStoredHistory(storage);
  if (stored) {
    return (stored.sessions[sessionId] ?? [])
      .filter(isHistoryEntry)
      .slice(-maximumEntriesPerSession);
  }

  // v1はセッションを持たない。移行直後のアクティブセッションにだけ復元する。
  return readLegacyHistory(storage, sessionId);
}

export function appendConversationHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
  sessionId: string,
  entry: ConversationHistoryEntry,
): void {
  const stored = readStoredHistory(storage) ?? {
    version: 3 as const,
    sessions: {},
  };
  const previous = stored.sessions[sessionId] ?? readLegacyHistory(storage, sessionId);
  const sessions = {
    ...stored.sessions,
    [sessionId]: [...previous, entry].slice(-maximumEntriesPerSession),
  };
  const retainedSessionIds = Object.keys(sessions).slice(-maximumSessions);
  storage.setItem(conversationHistoryStorageKey, JSON.stringify({
    version: 3,
    sessions: Object.fromEntries(
      retainedSessionIds.map((id) => [id, sessions[id]]),
    ),
  } satisfies StoredConversationHistory));
}

export function deleteConversationHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
  sessionId: string,
): void {
  if (!isSafeIdentifier(sessionId)) return;
  const stored = readStoredHistory(storage);
  if (!stored || !(sessionId in stored.sessions)) return;
  const sessions = { ...stored.sessions };
  delete sessions[sessionId];
  storage.setItem(conversationHistoryStorageKey, JSON.stringify({
    version: 3,
    sessions,
  } satisfies StoredConversationHistory));
}

export function recentConversationContext(
  entries: ConversationHistoryEntry[],
  currentPrompt?: string,
): string {
  const recent = entries.slice(-3);
  const last = recent.at(-1);
  if (currentPrompt && last?.role === "user" && last.text === currentPrompt) {
    recent.pop();
  }
  return JSON.stringify(recent.map((entry) => entry.role === "user"
    ? { role: entry.role, text: entry.text.slice(0, 120) }
    : { role: entry.role, text: responseText(entry.response).slice(0, 120) }));
}

function readStoredHistory(
  storage: Pick<Storage, "getItem">,
): StoredConversationHistory | undefined {
  try {
    const raw = storage.getItem(conversationHistoryStorageKey);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 3 || !isRecord(value.sessions)) {
      return undefined;
    }
    return {
      version: 3,
      sessions: Object.fromEntries(
        Object.entries(value.sessions).flatMap(([sessionId, entries]) =>
          isSafeIdentifier(sessionId) && Array.isArray(entries)
            ? [[sessionId, entries.filter(isHistoryEntry).slice(-maximumEntriesPerSession)]]
            : []),
      ),
    };
  } catch {
    return undefined;
  }
}

function readLegacyHistory(
  storage: Pick<Storage, "getItem">,
  sessionId?: string,
): ConversationHistoryEntry[] {
  try {
    const previousRaw = storage.getItem(previousConversationHistoryStorageKey);
    if (previousRaw) {
      const previous: unknown = JSON.parse(previousRaw);
      if (isRecord(previous) && previous.version === 2 && isRecord(previous.sessions)) {
        const entries = sessionId
          ? Array.isArray(previous.sessions[sessionId])
            ? previous.sessions[sessionId]
            : []
          : Object.values(previous.sessions).find(Array.isArray) ?? [];
        return withLegacyMessageIds(entries).slice(-maximumEntriesPerSession);
      }
    }
    const raw = storage.getItem(legacyConversationHistoryStorageKey);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? withLegacyMessageIds(value).slice(-maximumEntriesPerSession)
      : [];
  } catch {
    return [];
  }
}

function isHistoryEntry(value: unknown): value is ConversationHistoryEntry {
  if (!isRecord(value)) return false;
  if (!isSafeIdentifier(value.messageId)) return false;
  return value.role === "user" && typeof value.text === "string" ||
    value.role === "assistant" && isViewerAgentResponse(value.response) &&
      (value.requestId === undefined || isSafeIdentifier(value.requestId));
}

function withLegacyMessageIds(values: unknown[]): ConversationHistoryEntry[] {
  return values.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const candidate = {
      ...value,
      messageId: isSafeIdentifier(value.messageId)
        ? value.messageId
        : `legacy-message-${index + 1}`,
    };
    return isHistoryEntry(candidate) ? [candidate] : [];
  });
}

function isViewerAgentResponse(value: unknown): value is ViewerAgentResponse {
  if (typeof value === "string") return true;
  if (!isRecord(value) || typeof value.text !== "string") return false;
  return "journeyPlan" in value || "travelPlan" in value ||
    "conversation" in value || "tripPlanUpdate" in value;
}

function responseText(response: ViewerAgentResponse): string {
  return typeof response === "string" ? response : response.text;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
