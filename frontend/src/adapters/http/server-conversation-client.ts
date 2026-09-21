import { parsePublicCostProposal } from "@raiquora/trip/public-cost-proposal";
import { parseConsultationRequestProposal } from "@raiquora/trip/consultation-request-proposal";
import { parseConsultationRequest } from "@raiquora/trip/consultation-request";
import { parsePublicRequestProposal } from "@raiquora/trip/public-request-proposal";
import { requestSessionVersion } from "./authenticated-fetch";
import { personalApiFetch } from "./personal-api-fetch";
import type { ServerConversation, ServerConversationClient, ServerConversationMessage, ServerConversationMetadata, ServerPage } from "../../usecases/personal-state/server-conversation-client";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function validMetadata(value: unknown): value is ServerConversationMetadata {
  const v = value as Partial<ServerConversationMetadata>;
  try { if (v?.draftRequest !== undefined) { if (v.tripId) return false; parseConsultationRequest(v.draftRequest); } } catch { return false; }
  return !!v && typeof v === "object" && typeof v.title === "string" && ["general", "trip", "place", "route"].includes(v.scope ?? "") && typeof v.summary === "string" &&
    Array.isArray(v.resolvedTopics) && v.resolvedTopics.every((x) => typeof x === "string") && Array.isArray(v.pendingTopics) && v.pendingTopics.every((x) => typeof x === "string") && (v.tripId === undefined || typeof v.tripId === "string");
}
function validConversation(value: unknown): value is ServerConversation {
  const v = value as Partial<ServerConversation>;
  return validMetadata(value) && typeof v.conversationId === "string" && uuid.test(v.conversationId) && typeof v.createdAt === "string" && typeof v.updatedAt === "string" && Number.isSafeInteger(v.revision) && Number.isSafeInteger(v.messageCount);
}
function page<T>(value: unknown, item: (value: unknown) => value is T): ServerPage<T> {
  const v = value as { items?: unknown; nextAfter?: unknown };
  if (!v || typeof v !== "object" || !Array.isArray(v.items) || !v.items.every(item) || v.nextAfter !== undefined && typeof v.nextAfter !== "string") throw new Error("Invalid Conversation API response");
  return { items: structuredClone(v.items), ...(v.nextAfter ? { nextAfter: v.nextAfter } : {}) };
}
function validMessage(value: unknown): value is ServerConversationMessage {
  const v = value as Partial<ServerConversationMessage>;
  try { if (v?.tripCostProposal !== undefined) { if (v.role !== "assistant" || v.consultationRequestProposal !== undefined) return false; parsePublicCostProposal(v.tripCostProposal); } if (v?.consultationRequestProposal !== undefined) { if (v.role !== "assistant" || v.tripUpdateProposal !== undefined) return false; parseConsultationRequestProposal(v.consultationRequestProposal); } if (v?.tripUpdateProposal !== undefined) { if (v.role !== "assistant") return false; parsePublicRequestProposal(v.tripUpdateProposal); } } catch { return false; }
  return !!v && typeof v === "object" && (v.role === "user" || v.role === "assistant") && typeof v.text === "string" && Number.isSafeInteger(v.sequence) && typeof v.createdAt === "string";
}
export class HttpServerConversationClient implements ServerConversationClient {
  constructor(private readonly endpoint = "/api/conversations/v1", private readonly request: typeof fetch = personalApiFetch) {}
  private async execute(command: Record<string, unknown>) {
    const epoch = requestSessionVersion(this.request);
    const response = await this.request(this.endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "conversation-api-v1", ...command }), signal: AbortSignal.timeout(15_000) });
    if (response.status === 404 && ["get", "history"].includes(command.operation as string)) return undefined;
    if (!response.ok) throw new Error("Conversation API unavailable");
    const value: unknown = await response.json();
    if (epoch !== requestSessionVersion(this.request) || !value || typeof value !== "object" || (value as { version?: unknown }).version !== "conversation-api-v1") throw new Error("Invalid Conversation API response");
    return value as Record<string, unknown>;
  }
  async create(metadata: ServerConversationMetadata) { const v = await this.execute({ operation: "create", metadata }); if (!validConversation(v?.conversation)) throw new Error("Invalid Conversation API response"); return structuredClone(v.conversation); }
  async get(conversationId: string) { const v = await this.execute({ operation: "get", conversationId }); if (!v) return undefined; if (!validConversation(v.conversation) || v.conversation.conversationId !== conversationId) throw new Error("Invalid Conversation API response"); return structuredClone(v.conversation); }
  async list(pageOptions: { limit?: number; after?: string } = {}) { const v = await this.execute({ operation: "list", page: pageOptions }); return page(v, validConversation); }
  async history(conversationId: string, pageOptions: { limit?: number; after?: string } = {}) { const v = await this.execute({ operation: "history", conversationId, page: pageOptions }); if (!v) throw new Error("Conversation API unavailable"); return page(v, validMessage); }
  async update(conversationId: string, expectedRevision: number, metadata: ServerConversationMetadata) { const v = await this.execute({ operation: "update", conversationId, expectedRevision, metadata }); if (!validConversation(v?.conversation) || v.conversation.conversationId !== conversationId) throw new Error("Invalid Conversation API response"); return structuredClone(v.conversation); }
  async delete(conversationId: string, expectedRevision: number) { const v = await this.execute({ operation: "delete", conversationId, expectedRevision }); if (!v || typeof v.complete !== "boolean") throw new Error("Invalid Conversation API response"); return { complete: v.complete }; }
}
