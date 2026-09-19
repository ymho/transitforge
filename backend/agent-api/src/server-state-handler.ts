import { randomUUID } from "node:crypto";
import { authenticationErrorResponse, httpMethod } from "./adapters/http-api-auth.js";
import { requirePersonalOperation, type PersonalApi } from "./adapters/api-route-policy.js";
import { jsonResponse, type LambdaContext, type LambdaHttpEvent } from "./contracts/http.js";
import { StateError, exactObject } from "./contracts/server-state.js";
import { TripResourceError } from "./contracts/trip-api.js";
import type { TrustedPrincipal } from "./contracts/trusted-principal.js";
import type { ConversationApplication } from "./usecases/conversation-application.js";
import type { ProfileApplication } from "./usecases/profile-application.js";

type PrincipalResolver = (event: LambdaHttpEvent) => Promise<TrustedPrincipal | undefined>;
const bodyBytes = 160 * 1024;
function stateResponse(error: unknown, version: string, requestId: string) {
  const auth = authenticationErrorResponse(error, version, requestId);
  if (auth) return auth;
  const code = error instanceof StateError ? error.code : error instanceof TripResourceError && error.code === "invalid-input" ? "invalid-input" : "unavailable";
  return jsonResponse({ "invalid-input": 400, "not-found": 404, conflict: 409, unavailable: 501 }[code], { version, error: code }, requestId);
}
function command(event: LambdaHttpEvent, route: PersonalApi) {
  if (httpMethod(event) !== "POST" || typeof event.body !== "string" || event.body.length > bodyBytes * 2) throw new StateError("invalid-input");
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (Buffer.byteLength(raw, "utf8") > bodyBytes) throw new StateError("invalid-input");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new StateError("invalid-input"); }
  requirePersonalOperation(route, event, value);
  return value as Record<string, unknown>;
}
function id(value: Record<string, unknown>) { return value.conversationId; }
function publicConversation(value: { ownerSubject: string }) { const { ownerSubject: _ownerSubject, ...conversation } = value; return conversation; }
function conversationCommand(value: Record<string, unknown>) {
  switch (value.operation) {
    case "create": exactObject(value, ["version", "operation", "metadata"]); break;
    case "get": exactObject(value, ["version", "operation", "conversationId"]); break;
    case "list": exactObject(value, ["version", "operation", "page"]); break;
    case "history": exactObject(value, ["version", "operation", "conversationId", "page"]); break;
    case "update": exactObject(value, ["version", "operation", "conversationId", "expectedRevision", "metadata"]); break;
    case "delete": exactObject(value, ["version", "operation", "conversationId", "expectedRevision"]); break;
    default: throw new StateError("invalid-input");
  }
}
function profileCommand(value: Record<string, unknown>) {
  switch (value.operation) {
    case "get": exactObject(value, ["version", "operation"]); break;
    case "update": exactObject(value, ["version", "operation", "profile", "expectedRevision"]); break;
    case "delete": exactObject(value, ["version", "operation", "expectedRevision"]); break;
    default: throw new StateError("invalid-input");
  }
}

export function createConversationApiHandler(application: Pick<ConversationApplication, "create" | "get" | "list" | "history" | "update" | "delete">, authenticate: PrincipalResolver) {
  return async (event: LambdaHttpEvent, context?: LambdaContext) => {
    const requestId = context?.awsRequestId ?? randomUUID(), version = "conversation-api-v1";
    try {
      const principal = await authenticate(event), value = command(event, "conversation"); conversationCommand(value);
      switch (value.operation) {
        case "create": return jsonResponse(200, { version, conversation: publicConversation(await application.create(principal!, value.metadata)) }, requestId);
        case "get": return jsonResponse(200, { version, conversation: publicConversation(await application.get(principal!, id(value) as string)) }, requestId);
        case "list": { const result = await application.list(principal!, value.page as { limit?: number; after?: string } ?? {}); return jsonResponse(200, { version, items: result.items.map(publicConversation), ...(result.nextAfter ? { nextAfter: result.nextAfter } : {}) }, requestId); }
        case "history": return jsonResponse(200, { version, ...(await application.history(principal!, id(value) as string, value.page as { limit?: number; after?: string } ?? {})) }, requestId);
        case "update": return jsonResponse(200, { version, conversation: publicConversation(await application.update(principal!, id(value) as string, value.expectedRevision as number, value.metadata)) }, requestId);
        case "delete": return jsonResponse(200, { version, ...(await application.delete(principal!, id(value) as string, value.expectedRevision as number)) }, requestId);
        default: throw new StateError("invalid-input");
      }
    } catch (error) { return stateResponse(error, version, requestId); }
  };
}

export function createProfileApiHandler(application: Pick<ProfileApplication, "get" | "update" | "delete">, authenticate: PrincipalResolver) {
  return async (event: LambdaHttpEvent, context?: LambdaContext) => {
    const requestId = context?.awsRequestId ?? randomUUID(), version = "profile-api-v1";
    try {
      const principal = await authenticate(event), value = command(event, "profile"); profileCommand(value);
      switch (value.operation) {
        case "get": return jsonResponse(200, { version, profile: await application.get(principal!) ?? null }, requestId);
        case "update": return jsonResponse(200, { version, ...(await application.update(principal!, value.profile, value.expectedRevision as number | null)) }, requestId);
        case "delete": await application.delete(principal!, value.expectedRevision as number); return jsonResponse(200, { version, ok: true }, requestId);
        default: throw new StateError("invalid-input");
      }
    } catch (error) { return stateResponse(error, version, requestId); }
  };
}
