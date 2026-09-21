import { createTrip, type Trip } from "@raiquora/trip/trip";
import { parseConsultationRequest } from "@raiquora/trip/consultation-request";
import type { TripRequest } from "@raiquora/trip/trip-request";
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
  /** Ephemeral form projection only: never sent to the Trip API or model as an adopted Trip. */
  draftView(id: string): Trip | undefined {
    const session = this.sessions.find(s => s.id === id);
    if (!session || session.tripId) return undefined;
    return { ...createTrip(session.id, "相談中の条件", session.createdAt, [], session.draftRequest), revision: session.revision };
  }
  async saveDraftRequest(id: string, expected: TripRequest, next: TripRequest): Promise<void> {
    this.requireAuthentication();
    const generation = this.generation, request = parseConsultationRequest(next), before = parseConsultationRequest(expected);
    const current = await this.client.get(id);
    if (generation !== this.generation || !current || current.tripId) throw new Error("Conversation changed");
    const actual = current.draftRequest ?? { constraints: [], assumptions: [] };
    if (JSON.stringify(actual) !== JSON.stringify(request)) {
      if (JSON.stringify(actual) !== JSON.stringify(before)) throw new Error("条件が更新されています。会話を開き直してください。");
      await this.client.update(id, current.revision, { ...metadataOf(toSession(current)), draftRequest: request });
      if (generation !== this.generation) throw new Error("Conversation changed");
    }
    const saved = await this.client.get(id);
    if (generation !== this.generation || !saved || saved.tripId || JSON.stringify(saved.draftRequest ?? { constraints: [], assumptions: [] }) !== JSON.stringify(request)) throw new Error("条件の保存結果を確認できません。");
    this.sessions = this.sessions.map(s => s.id === id ? toSession(saved) : s); this.notify();
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
    const current = () => generation === this.historyGeneration && this.activeId === id;
    const snapshot = await this.client.get(id);
    if (!current()) return [];
    if (!snapshot) throw new Error("Conversation unavailable");
    const start = Math.max(0, snapshot.messageCount - 50);
    let last = start;
    const items: import("./server-conversation-client").ServerConversationMessage[] = [];
    // Seek to the recent history. Dynamo byte pages can split even a 50-message window.
    while (last < snapshot.messageCount) {
      const page = await this.client.history(id, { limit: snapshot.messageCount - last, after: String(last).padStart(12, "0") });
      if (!current()) return [];
      if (!page.items.length) throw new Error("Incomplete Conversation history");
      for (const item of page.items) {
        if (item.sequence !== last + 1 || item.sequence > snapshot.messageCount) throw new Error("Invalid Conversation history sequence");
        items.push(item); last = item.sequence;
      }
    }
    const latest = await this.client.get(id);
    if (!current()) return [];
    if (latest?.revision !== snapshot.revision) throw new Error("Conversation changed while loading history");
    const entries: ConversationMessage[] = items.map((item) => item.role === "user"
      ? { messageId: `${id}:${item.sequence}`, role: "user", text: item.text }
      : { messageId: `${id}:${item.sequence}`, role: "assistant", response: item.tripCostProposal ? { text: item.text, tripCostProposal: item.tripCostProposal, ...(item.tripUpdateProposal ? { tripUpdateProposal: item.tripUpdateProposal } : {}) } : item.consultationRequestProposal ? { text: item.text, consultationRequestProposal: item.consultationRequestProposal } : item.tripUpdateProposal ? { text: item.text, tripUpdateProposal: item.tripUpdateProposal } : item.text });
    this.sessions = this.sessions.map(session => session.id === id ? toSession(latest!) : session);
    this.histories.set(id, entries); this.notify(); return structuredClone(entries);
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
    resolvedTopics: value.resolvedTopics, pendingTopics: value.pendingTopics, tripId: value.tripId, draftRequest: value.draftRequest,
    createdAt: value.createdAt, updatedAt: value.updatedAt, revision: value.revision };
}
function metadataOf(value: ConversationSession): ServerConversationMetadata {
  return { title: value.title, scope: value.scope, summary: value.summary,
    resolvedTopics: value.resolvedTopics, pendingTopics: value.pendingTopics, ...(value.tripId ? { tripId: value.tripId } : {}), ...(value.draftRequest ? { draftRequest: value.draftRequest } : {}) };
}
function metadataFor(value: Partial<ServerConversationMetadata>): ServerConversationMetadata {
  return { title: value.title ?? "新しい会話", scope: value.scope ?? "general", summary: value.summary ?? "",
    resolvedTopics: value.resolvedTopics ?? [], pendingTopics: value.pendingTopics ?? [], ...(value.tripId ? { tripId: value.tripId } : {}), ...(value.draftRequest ? { draftRequest: value.draftRequest } : {}) };
}
