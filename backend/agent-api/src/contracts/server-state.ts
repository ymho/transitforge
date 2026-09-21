import { parseConsultationRequest } from "@raiquora/trip/consultation-request";
import { isUserProfile, type UserProfile } from "@raiquora/trip/travel-profile";
import { AuthenticationError, type TrustedPrincipal } from "./trusted-principal.js";

/** Transport-independent, content-free errors. Missing and foreign resources are identical. */
export class StateError extends Error {
  constructor(readonly code: "invalid-input" | "not-found" | "conflict" | "unavailable") { super(code); }
}
export interface ConversationMetadata {
  title: string;
  scope: "general" | "trip" | "place" | "route";
  summary: string;
  resolvedTopics: string[];
  pendingTopics: string[];
  /** Reference only. Following it requires independent Trip authorization. */
  tripId?: string;
  draftRequest?: import("@raiquora/trip/trip-request").TripRequest;
}
export interface Conversation extends ConversationMetadata {
  conversationId: string;
  ownerSubject: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  messageCount: number;
}
export interface MessageInput { role: "user" | "assistant"; text: string }
export interface ConversationMessage extends MessageInput { sequence: number; createdAt: string; tripUpdateProposal?: import("@raiquora/trip/public-request-proposal").PublicRequestProposal; consultationRequestProposal?: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal; tripCostProposal?: import("@raiquora/trip/public-cost-proposal").PublicCostProposal }
export interface ProfileState { profile: UserProfile; revision: number }
export interface StateClock { now(): Date }
export interface PageOptions { limit?: number; after?: string }
export interface StatePage<T> { items: T[]; nextAfter?: string }

/** Structural defense only; authentication remains #484's verifier, never JSON deserialization. */
export function requireStatePrincipal(value: TrustedPrincipal | undefined): asserts value is TrustedPrincipal {
  if (!value || typeof value.subject !== "string" || !/^identity-v1:[0-9a-f]{64}$/.test(value.subject) ||
    typeof value.identity?.issuer !== "string" || !value.identity.issuer ||
    typeof value.identity.subject !== "string" || !value.identity.subject || !Array.isArray(value.scopes)) {
    throw new AuthenticationError("unauthenticated");
  }
}
export function stateId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new StateError("invalid-input");
}
export function revision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) throw new StateError("invalid-input");
}
export function exactObject(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new StateError("invalid-input");
}
function text(value: unknown, maximum: number): boolean { return typeof value === "string" && value.length <= maximum; }
export function metadata(value: unknown): ConversationMetadata {
  exactObject(value, ["title", "scope", "summary", "resolvedTopics", "pendingTopics", "tripId", "draftRequest"]);
  if (!text(value.title, 160) || typeof value.scope !== "string" || !["general", "trip", "place", "route"].includes(value.scope) || !text(value.summary, 4000) ||
    ![value.resolvedTopics, value.pendingTopics].every((v) => Array.isArray(v) && v.length <= 20 && v.every((t) => text(t, 200)))) throw new StateError("invalid-input");
  if (value.tripId !== undefined) stateId(value.tripId);
  if (value.draftRequest !== undefined) {
    if (value.tripId !== undefined) throw new StateError("invalid-input");
    try { parseConsultationRequest(value.draftRequest); } catch { throw new StateError("invalid-input"); }
  }
  return structuredClone(value) as unknown as ConversationMetadata;
}
export function messageInputs(value: unknown): MessageInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new StateError("invalid-input");
  return value.map((entry) => {
    exactObject(entry, ["role", "text"]);
    if (entry.role !== "user" && entry.role !== "assistant" || typeof entry.text !== "string" || !entry.text.length ||
      Buffer.byteLength(entry.text, "utf8") > 16 * 1024) throw new StateError("invalid-input");
    return { role: entry.role, text: entry.text };
  });
}
/** Reuse the Domain validator; add only storage envelope/size and authority-field restrictions. */
export function boundedProfile(value: unknown): UserProfile {
  exactObject(value, ["version", "home", "companions", "travelStyle", "preferences", "transport", "notes", "aiNoteFields", "updatedAt"]);
  if (!isUserProfile(value)) throw new StateError("invalid-input");
  try {
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new Error();
    const copy: unknown = JSON.parse(raw);
    if (!isUserProfile(copy)) throw new Error();
    return copy;
  } catch { throw new StateError("invalid-input"); }
}
export function pageOptions(value: PageOptions): { limit: number; after?: string } {
  exactObject(value, ["limit", "after"]);
  const limit = value.limit === undefined ? 20 : value.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50 || value.after !== undefined && typeof value.after !== "string") throw new StateError("invalid-input");
  return { limit, after: value.after };
}
