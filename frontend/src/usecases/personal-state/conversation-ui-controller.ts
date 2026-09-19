import type { ConversationSession } from "../../domain/conversation-session";
import type { ConversationHistoryRepository, ConversationMessage } from "../concierge/conversation-history-repository";
import type { ServerConversation, ServerConversationClient, ServerConversationMetadata } from "./server-conversation-client";

/** Account-scoped browser read model. It never persists Conversation data locally. */
export class ConversationUiController {
  private sessions: Array<ConversationSession & { revision: number }> = [];
  private activeId: string | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly histories = new Map<string, ConversationMessage[]>();
  private historyGeneration = 0;
  readonly historyRepository: ConversationHistoryRepository = {
    list: (id) => structuredClone(this.histories.get(id) ?? []),
    append: (id, message) => {
      const stored = { ...message, messageId: crypto.randomUUID() } as ConversationMessage;
      this.histories.set(id, [...(this.histories.get(id) ?? []), stored].slice(-50));
      return structuredClone(stored);
    },
    delete: (id) => { this.histories.delete(id); },
  };

  constructor(private readonly client: ServerConversationClient) {}

  list(): ConversationSession[] { return structuredClone(this.sessions); }
  active(): ConversationSession | undefined { return structuredClone(this.sessions.find((item) => item.id === this.activeId)); }
  selectLocal(id: string): ConversationSession | undefined {
    const found = this.sessions.find((item) => item.id === id);
    if (!found) return undefined;
    this.activeId = id; this.notify(); return structuredClone(found);
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  clear(): void { this.sessions = []; this.activeId = undefined; this.histories.clear(); this.historyGeneration++; this.notify(); }

  async hydrate(): Promise<ConversationSession | undefined> {
    const page = await this.client.list({ limit: 50 });
    this.sessions = page.items.map(toSession);
    this.activeId = this.sessions.some((item) => item.id === this.activeId) ? this.activeId : this.sessions[0]?.id;
    this.histories.clear(); this.notify();
    return this.active();
  }
  async create(metadata: Partial<ServerConversationMetadata> = {}): Promise<ConversationSession> {
    const created = await this.client.create(metadataFor(metadata));
    const session = toSession(created);
    this.sessions = [session, ...this.sessions.filter((item) => item.id !== session.id)];
    this.activeId = session.id; this.notify();
    return structuredClone(session);
  }
  async update(id: string, metadata: ServerConversationMetadata): Promise<ConversationSession> {
    const previous = this.sessions.find((item) => item.id === id);
    if (!previous) throw new Error("Conversation unavailable");
    const saved = toSession(await this.client.update(id, previous.revision!, metadata));
    this.sessions = this.sessions.map((item) => item.id === id ? saved : item); this.notify();
    return structuredClone(saved);
  }
  async rename(id: string, title: string): Promise<ConversationSession> {
    const current = this.sessions.find((item) => item.id === id);
    if (!current) throw new Error("Conversation unavailable");
    return this.update(id, { ...metadataOf(current), title: title.trim().slice(0, 80) || "新しい会話" });
  }
  async delete(id: string): Promise<ConversationSession | undefined> {
    const current = this.sessions.find((item) => item.id === id);
    if (!current) return this.active();
    let result = await this.client.delete(id, current.revision!);
    while (!result.complete) result = await this.client.delete(id, current.revision!);
    this.sessions = this.sessions.filter((item) => item.id !== id); this.histories.delete(id);
    if (this.activeId === id) this.activeId = this.sessions[0]?.id;
    this.notify(); return this.active();
  }
  async loadHistory(id: string): Promise<ConversationMessage[]> {
    const generation = ++this.historyGeneration;
    const page = await this.client.history(id, { limit: 50 });
    if (generation !== this.historyGeneration || this.activeId !== id) return [];
    const entries: ConversationMessage[] = page.items.map((item) => item.role === "user"
      ? { messageId: `${id}:${item.sequence}`, role: "user", text: item.text }
      : { messageId: `${id}:${item.sequence}`, role: "assistant", response: item.text });
    this.histories.set(id, entries); return structuredClone(entries);
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}

function toSession(value: ServerConversation): ConversationSession & { revision: number } {
  return { id: value.conversationId, title: value.title, scope: value.scope, summary: value.summary,
    resolvedTopics: value.resolvedTopics, pendingTopics: value.pendingTopics, tripId: value.tripId,
    createdAt: value.createdAt, updatedAt: value.updatedAt, revision: value.revision };
}
function metadataOf(value: ConversationSession): ServerConversationMetadata {
  return { title: value.title, scope: value.scope, summary: value.summary,
    resolvedTopics: value.resolvedTopics, pendingTopics: value.pendingTopics, ...(value.tripId ? { tripId: value.tripId } : {}) };
}
function metadataFor(value: Partial<ServerConversationMetadata>): ServerConversationMetadata {
  return { title: value.title ?? "新しい会話", scope: value.scope ?? "general", summary: value.summary ?? "",
    resolvedTopics: value.resolvedTopics ?? [], pendingTopics: value.pendingTopics ?? [], ...(value.tripId ? { tripId: value.tripId } : {}) };
}
