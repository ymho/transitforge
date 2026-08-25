import type { ConversationSessionRepository } from "../../application/concierge/conversation-session-repository";
import {
  conversationSessionStorageKey as conversationSessionStorageKeyV2,
  createConversationSession,
  legacyConversationSessionStorageKey,
  parseConversationSession,
  type ConversationScope,
  type ConversationSession,
} from "../../domain/conversation-session";
import { deleteConversationHistory } from "../../domain/conversation-history";
import { deleteTripPlan } from "../../domain/trip-plan";

export const conversationSessionStorageKey = "transitforge.conversation-sessions.v3";
export const maximumConversationSessions = 20;

interface ConversationSessionStoreV3 {
  version: 3;
  activeSessionId: string;
  sessions: ConversationSession[];
}

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ConversationSessionStorageEvents {
  subscribe(listener: (key: string | null) => void): () => void;
}

export class LocalConversationSessionRepository
implements ConversationSessionRepository {
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeStorage?: () => void;

  constructor(
    private readonly storage: SessionStorage,
    events?: ConversationSessionStorageEvents,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.migrate();
    this.unsubscribeStorage = events?.subscribe((key) => {
      if (key === null || key === conversationSessionStorageKey) this.notify();
    });
  }

  list(): ConversationSession[] {
    return this.read()?.sessions.map(copySession) ?? [];
  }

  active(): ConversationSession | undefined {
    const store = this.read();
    return copyOptionalSession(store?.sessions.find(({ id }) =>
      id === store.activeSessionId));
  }

  create(
    scope: ConversationScope = "general",
    title = "新しい会話",
  ): ConversationSession {
    const session = {
      ...createConversationSession(scope, undefined, this.now()),
      title: normalizedTitle(title),
    };
    this.persistWith(session, session.id);
    return copySession(session);
  }

  select(sessionId: string): ConversationSession | undefined {
    const store = this.read();
    const session = store?.sessions.find(({ id }) => id === sessionId);
    if (!store || !session) return undefined;
    this.write({ ...store, activeSessionId: session.id });
    return copySession(session);
  }

  rename(sessionId: string, title: string): ConversationSession | undefined {
    const store = this.read();
    const session = store?.sessions.find(({ id }) => id === sessionId);
    if (!store || !session) return undefined;
    return this.save({
      ...session,
      title: normalizedTitle(title),
      updatedAt: this.now().toISOString(),
    });
  }

  save(session: ConversationSession): ConversationSession {
    const parsed = parseConversationSession(session);
    if (!parsed) throw new Error("会話Sessionが不正です");
    this.persistWith(parsed, this.read()?.activeSessionId ?? parsed.id);
    return copySession(parsed);
  }

  delete(sessionId: string): ConversationSession {
    const store = this.read();
    if (!store?.sessions.some(({ id }) => id === sessionId)) {
      return this.active() ?? this.create();
    }
    const remaining = store.sessions.filter(({ id }) => id !== sessionId);
    this.cleanup(sessionId);
    if (remaining.length === 0) {
      const replacement = createConversationSession("general", undefined, this.now());
      this.write({
        version: 3,
        activeSessionId: replacement.id,
        sessions: [replacement],
      });
      return copySession(replacement);
    }
    const activeSessionId = store.activeSessionId === sessionId
      ? remaining[0].id
      : store.activeSessionId;
    this.write({ version: 3, activeSessionId, sessions: remaining });
    return copySession(
      remaining.find(({ id }) => id === activeSessionId) ?? remaining[0],
    );
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.unsubscribeStorage?.();
    this.listeners.clear();
  }

  private persistWith(session: ConversationSession, activeSessionId: string): void {
    const previous = this.read()?.sessions ?? [];
    const sessions = [
      session,
      ...previous.filter(({ id }) => id !== session.id),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const retained = sessions.slice(0, maximumConversationSessions);
    for (const removed of sessions.slice(maximumConversationSessions)) {
      this.cleanup(removed.id);
    }
    this.write({ version: 3, activeSessionId, sessions: retained });
  }

  private migrate(): void {
    if (this.read()) return;
    const v2 = parseStore(this.storage.getItem(conversationSessionStorageKeyV2), 2);
    const legacy = parseLegacy(this.storage.getItem(legacyConversationSessionStorageKey));
    const sessions = (v2?.sessions ?? (legacy ? [legacy] : []))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, maximumConversationSessions);
    if (sessions.length === 0) return;
    const requestedActiveId = v2?.activeSessionId;
    const activeSessionId = sessions.some(({ id }) => id === requestedActiveId)
      ? requestedActiveId as string
      : sessions[0].id;
    this.write({ version: 3, activeSessionId, sessions }, false);
    this.storage.removeItem(conversationSessionStorageKeyV2);
    this.storage.removeItem(legacyConversationSessionStorageKey);
  }

  private read(): ConversationSessionStoreV3 | undefined {
    return parseStore(this.storage.getItem(conversationSessionStorageKey), 3);
  }

  private write(store: ConversationSessionStoreV3, notify = true): void {
    this.storage.setItem(conversationSessionStorageKey, JSON.stringify(store));
    if (notify) this.notify();
  }

  private cleanup(sessionId: string): void {
    deleteConversationHistory(this.storage, sessionId);
    deleteTripPlan(this.storage, sessionId);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function browserConversationSessionStorageEvents(): ConversationSessionStorageEvents {
  return {
    subscribe(listener) {
      const handler = (event: StorageEvent) => listener(event.key);
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  };
}

function parseStore(
  raw: string | null,
  version: 2,
): { activeSessionId: string; sessions: ConversationSession[] } | undefined;
function parseStore(
  raw: string | null,
  version: 3,
): ConversationSessionStoreV3 | undefined;
function parseStore(
  raw: string | null,
  version: 2 | 3,
): { activeSessionId: string; sessions: ConversationSession[]; version?: 3 } | undefined {
  try {
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== version ||
      typeof value.activeSessionId !== "string" || !Array.isArray(value.sessions)) {
      return undefined;
    }
    const sessions = value.sessions.flatMap((candidate) => {
      const session = parseConversationSession(candidate);
      return session ? [session] : [];
    });
    if (sessions.length !== value.sessions.length || sessions.length === 0 ||
      !sessions.some(({ id }) => id === value.activeSessionId)) {
      return undefined;
    }
    return version === 3
      ? { version: 3, activeSessionId: value.activeSessionId, sessions }
      : { activeSessionId: value.activeSessionId, sessions };
  } catch {
    return undefined;
  }
}

function parseLegacy(raw: string | null): ConversationSession | undefined {
  try {
    return raw ? parseConversationSession(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

function normalizedTitle(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").slice(0, 80) || "新しい会話";
}

function copyOptionalSession(
  session: ConversationSession | undefined,
): ConversationSession | undefined {
  return session ? copySession(session) : undefined;
}

function copySession(session: ConversationSession): ConversationSession {
  return {
    ...session,
    resolvedTopics: [...session.resolvedTopics],
    pendingTopics: [...session.pendingTopics],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
