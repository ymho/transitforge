import { afterEach, describe, expect, it, vi } from "vitest";

import { appendConversationHistory, loadConversationHistory } from "../../domain/conversation-history";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import {
  loadTripPlan,
  saveTripPlan,
} from "../../application/trip-plan/trip-plan-repository";
import {
  conversationSessionStorageKey as conversationSessionStorageKeyV2,
} from "../../domain/conversation-session";
import {
  conversationSessionStorageKey,
  LocalConversationSessionRepository,
  maximumConversationSessions,
  type ConversationSessionStorageEvents,
} from "./conversation-session-repository";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class MemoryStorageEvents implements ConversationSessionStorageEvents {
  private listener?: (key: string | null) => void;

  subscribe(listener: (key: string | null) => void): () => void {
    this.listener = listener;
    return () => delete this.listener;
  }

  emit(key: string | null): void {
    this.listener?.(key);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("LocalConversationSessionRepository", () => {
  it("creates lists selects renames and reloads conversations", () => {
    let id = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `session-${++id}` });
    const storage = new MemoryStorage();
    const repository = new LocalConversationSessionRepository(storage);

    const first = repository.create("general", "最初の相談");
    const second = repository.create("trip", "出雲旅行");
    expect(repository.active()?.id).toBe(second.id);
    expect(repository.list().map(({ title }) => title)).toEqual([
      "出雲旅行",
      "最初の相談",
    ]);

    repository.select(first.id);
    repository.rename(second.id, "  出雲を巡る旅  ");
    expect(repository.active()?.id).toBe(first.id);
    expect(new LocalConversationSessionRepository(storage).list()
      .find(({ id: sessionId }) => sessionId === second.id)?.title)
      .toBe("出雲を巡る旅");
  });

  it("migrates v2 once without losing session ids or summaries", () => {
    const storage = new MemoryStorage({
      [conversationSessionStorageKeyV2]: JSON.stringify({
        version: 2,
        activeSessionId: "old-2",
        sessions: [
          session("old-1", "2026-08-23T00:00:00.000Z", "城崎を相談中"),
          session("old-2", "2026-08-24T00:00:00.000Z", "出雲を相談中"),
        ],
      }),
    });

    const repository = new LocalConversationSessionRepository(storage);
    expect(repository.active()).toMatchObject({
      id: "old-2",
      title: "出雲を相談中",
      summary: "出雲を相談中",
    });
    expect(repository.list().map(({ id }) => id)).toEqual(["old-2", "old-1"]);
    expect(storage.getItem(conversationSessionStorageKeyV2)).toBeNull();
    expect(storage.getItem(conversationSessionStorageKey)).toContain('"version":3');
  });

  it("deletes the conversation history request ids and trip plan together", () => {
    let id = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `session-${++id}` });
    const storage = new MemoryStorage();
    const repository = new LocalConversationSessionRepository(storage);
    const target = repository.create("trip", "削除する旅");
    repository.create("general", "残す会話");
    appendConversationHistory(storage, target.id, {
      messageId: "message-1",
      role: "assistant",
      response: "案内しました",
      requestId: "request-123",
    });
    saveTripPlan(storage, target.id, tripPlan());

    repository.delete(target.id);

    expect(repository.list().some(({ id: sessionId }) => sessionId === target.id))
      .toBe(false);
    expect(loadConversationHistory(storage, target.id)).toEqual([]);
    expect(loadTripPlan(storage, target.id)).toBeUndefined();
  });

  it("evicts the oldest conversation and its related data at the limit", () => {
    let id = 0;
    let minute = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `session-${++id}` });
    const storage = new MemoryStorage();
    const repository = new LocalConversationSessionRepository(
      storage,
      undefined,
      () => new Date(Date.UTC(2026, 7, 25, 0, minute++)),
    );
    const oldest = repository.create();
    appendConversationHistory(storage, oldest.id, { messageId: "message-1", role: "user", text: "古い会話" });
    saveTripPlan(storage, oldest.id, tripPlan());
    for (let index = 0; index < maximumConversationSessions; index += 1) {
      repository.create("general", `会話${index + 1}`);
    }

    expect(repository.list()).toHaveLength(maximumConversationSessions);
    expect(repository.list().some(({ id: sessionId }) => sessionId === oldest.id))
      .toBe(false);
    expect(loadConversationHistory(storage, oldest.id)).toEqual([]);
    expect(loadTripPlan(storage, oldest.id)).toBeUndefined();
  });

  it("notifies a tab when the v3 storage key changes", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "session-1" });
    const storage = new MemoryStorage();
    const events = new MemoryStorageEvents();
    const repository = new LocalConversationSessionRepository(storage, events);
    const listener = vi.fn();
    repository.subscribe(listener);

    repository.create();
    events.emit(conversationSessionStorageKey);
    events.emit("another-key");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("replaces the final deleted conversation with a fresh active session", () => {
    let id = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `session-${++id}` });
    const repository = new LocalConversationSessionRepository(new MemoryStorage());
    const only = repository.create();

    const replacement = repository.delete(only.id);

    expect(replacement.id).not.toBe(only.id);
    expect(repository.list()).toEqual([replacement]);
    expect(repository.active()).toEqual(replacement);
  });
});

function session(id: string, updatedAt: string, summary: string) {
  return {
    id,
    scope: "trip",
    summary,
    resolvedTopics: [],
    pendingTopics: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function tripPlan(): TripPlan {
  return {
    version: 1,
    id: "trip-1",
    title: "旅",
    destination: "出雲",
    items: [],
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}
