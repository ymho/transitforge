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
  private generation = 0;
  readonly historyRepository: ConversationHistoryRepository = {
    list: (id) => structuredClone(this.histories.get(id) ?? []),
    append: (id, message) => {
      const stored = { ...message, messageId: crypto.randomUUID() } as ConversationMessage;
      this.histories.set(id, [...(this.histories.get(id) ?? []), stored].slice(-50));
      return structuredClone(stored);
    },
    delete: (id) => { this.histories.delete(id); },
  };

  constructor(private readonly client: ServerConversationClient, private readonly canUse = () => true) {}

  list(): ConversationSession[] { return structuredClone(this.sessions); }
  active(): ConversationSession | undefined { return structuredClone(this.sessions.find((item) => item.id === this.activeId)); }
  selectLocal(id: string): ConversationSession | undefined {
    const found = this.sessions.find((item) => item.id === id);
    if (!found) return undefined;
    this.activeId = id; this.notify(); return structuredClone(found);
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  clear(): void { this.generation++; this.sessions = []; this.activeId = undefined; this.histories.clear(); this.historyGeneration++; this.notify(); }

  async hydrate(): Promise<ConversationSession | undefined> {
    this.requireAuthentication();
    const generation = ++this.generation;
    const page = await this.client.list({ limit: 50 });
    if (generation !== this.generation) return undefined;
    this.sessions = page.items.map(toSession);
    this.activeId = this.sessions.some((item) => item.id === this.activeId) ? this.activeId : this.sessions[0]?.id;
    this.histories.clear(); this.notify();
    return this.active();
  }
  async create(metadata: Partial<ServerConversationMetadata> = {}, select = true): Promise<ConversationSession> {
    this.requireAuthentication();
    const generation = this.generation;
    const created = await this.client.create(metadataFor(metadata));
    if (generation !== this.generation) throw new Error("Conversation session changed");
    const session = toSession(created);
    this.sessions = [session, ...this.sessions.filter((item) => item.id !== session.id)];
    if (select) this.activeId = session.id; this.notify();
    return structuredClone(session);
  }
  /** Search every server page; a matching title never establishes a Trip reference. */
  async findForTrip(tripId: string): Promise<ConversationSession | undefined> {
    this.requireAuthentication();
    const generation = this.generation;
    let after: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await this.client.list({ limit: 50, ...(after ? { after } : {}) });
      if (generation !== this.generation) throw new Error("Conversation session changed");
      for (const match of page.items.filter((value) => value.tripId === tripId)) {
        const fresh = await this.client.get(match.conversationId);
        if (generation !== this.generation) throw new Error("Conversation session changed");
        if (fresh?.tripId === tripId) {
          const session = toSession(fresh);
          this.sessions = [...this.sessions.filter((s) => s.id !== session.id), session];
          return structuredClone(session);
        }
      }
      after = page.nextAfter;
      if (after && cursors.has(after)) throw new Error("Repeated Conversation cursor");
      if (after) cursors.add(after);
    } while (after);
    return undefined;
  }
  async update(id: string, metadata: ServerConversationMetadata): Promise<ConversationSession> {
    this.requireAuthentication();
    const previous = this.sessions.find((item) => item.id === id);
    if (!previous) throw new Error("Conversation unavailable");
    const generation = this.generation;
    const saved = toSession(await this.client.update(id, previous.revision!, metadata));
    if (generation !== this.generation) throw new Error("Conversation session changed");
    this.sessions = this.sessions.map((item) => item.id === id ? saved : item); this.notify();
    return structuredClone(saved);
  }
  async rename(id: string, title: string): Promise<ConversationSession> {
    const current = this.sessions.find((item) => item.id === id);
    if (!current) throw new Error("Conversation unavailable");
    return this.update(id, { ...metadataOf(current), title: title.trim().slice(0, 80) || "新しい会話" });
  }
  async delete(id: string): Promise<ConversationSession | undefined> {
    this.requireAuthentication();
    const current = this.sessions.find((item) => item.id === id);
    if (!current) return this.active();
    const generation = this.generation;
    let result = await this.client.delete(id, current.revision!);
    while (!result.complete) result = await this.client.delete(id, current.revision!);
    if (generation !== this.generation) throw new Error("Conversation session changed");
    this.sessions = this.sessions.filter((item) => item.id !== id); this.histories.delete(id);
    if (this.activeId === id) this.activeId = this.sessions[0]?.id;
    this.notify(); return this.active();
  }
  async loadHistory(id: string): Promise<ConversationMessage[]> {
    this.requireAuthentication();
    const generation = ++this.historyGeneration;
    const page = await this.client.history(id, { limit: 50 });
    if (generation !== this.historyGeneration || this.activeId !== id) return [];
    const entries: ConversationMessage[] = page.items.map((item) => item.role === "user"
      ? { messageId: `${id}:${item.sequence}`, role: "user", text: item.text }
      : { messageId: `${id}:${item.sequence}`, role: "assistant", response: item.text });
    this.histories.set(id, entries); return structuredClone(entries);
  }
  /** Read back a server-side reference after a Trip write; never synthesize a local link. */
  async refresh(id: string): Promise<ConversationSession | undefined> {
    this.requireAuthentication();
    const generation = this.generation, value = await this.client.get(id);
    if (generation !== this.generation || !value) return undefined;
    const session = toSession(value);
    this.sessions = this.sessions.map((item) => item.id === id ? session : item); this.notify();
    return structuredClone(session);
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
  private requireAuthentication(): void { if (!this.canUse()) throw new Error("Authentication required"); }
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
