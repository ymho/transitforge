import { describe, expect, it, vi } from "vitest";
import {
  conversationContextSummary,
  conversationSessionStorageKey,
  createConversationSession,
  loadConversationSession,
  loadTravelMemories,
  rememberTravelPreference,
  saveConversationSession,
} from "./conversation-session";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("conversation session", () => {
  it("creates a scoped UUID session", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "session-id" });
    expect(createConversationSession("trip", "trip-1", new Date("2026-08-24T00:00:00Z"))).toMatchObject({ id: "session-id", scope: "trip", tripPlanId: "trip-1" });
    vi.unstubAllGlobals();
  });

  it("only includes high confidence memories in model context", () => {
    const session = { id: "s", scope: "general" as const, summary: "", resolvedTopics: [], pendingTopics: [], createdAt: "", updatedAt: "" };
    const summary = conversationContextSummary(undefined, undefined, session, [
      { id: "1", statement: "早朝を避けたい", confidence: "high", sourceSessionId: "s", createdAt: "" },
      { id: "2", statement: "海が好きかもしれない", confidence: "low", sourceSessionId: "s", createdAt: "" },
    ]);
    expect(summary).toContain("早朝を避けたい");
    expect(summary).not.toContain("海が好きかもしれない");
  });

  it("bounds a large model context without producing broken JSON", () => {
    const session = {
      id: "s",
      scope: "trip" as const,
      summary: "長い相談".repeat(200),
      resolvedTopics: [],
      pendingTopics: Array.from({ length: 8 }, (_, index) => `話題${index}`),
      createdAt: "",
      updatedAt: "",
    };
    const memories = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      statement: `継続的な好み${index}`.repeat(20),
      confidence: "high" as const,
      sourceSessionId: "s",
      createdAt: "",
    }));
    const summary = conversationContextSummary(undefined, undefined, session, memories);

    expect(() => JSON.parse(summary)).not.toThrow();
    expect(summary.length).toBeLessThanOrEqual(1_100);
  });

  it("keeps recent sessions and restores the active session", () => {
    const storage = memoryStorage();
    const first = { id: "first", scope: "general" as const, summary: "", resolvedTopics: [], pendingTopics: [], createdAt: "2026-08-23", updatedAt: "2026-08-23" };
    const second = { ...first, id: "second", scope: "trip" as const, updatedAt: "2026-08-24" };
    saveConversationSession(storage, first);
    saveConversationSession(storage, second);

    expect(loadConversationSession(storage)).toEqual(second);
    expect(storage.getItem(conversationSessionStorageKey)).toContain("first");
  });

  it("rejects malformed memories and deduplicates learned preferences", () => {
    const storage = memoryStorage({
      "transitforge.travel-memories.v1": JSON.stringify([{ statement: "broken" }]),
    });
    vi.stubGlobal("crypto", { randomUUID: () => "memory-id" });
    rememberTravelPreference(storage, " 早朝は避けたい ", "session-id", "high");
    rememberTravelPreference(storage, "早朝は避けたい", "session-id", "high");

    expect(loadTravelMemories(storage)).toHaveLength(1);
    expect(loadTravelMemories(storage)[0].statement).toBe("早朝は避けたい");
    vi.unstubAllGlobals();
  });
});
