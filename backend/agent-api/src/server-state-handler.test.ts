import { describe, expect, it } from "vitest";
import { createHttpPrincipalResolver } from "./http-auth-composition.js";
import { createConversationApiHandler, createProfileApiHandler } from "./server-state-handler.js";
import { ConversationApplication } from "./usecases/conversation-application.js";
import { ProfileApplication } from "./usecases/profile-application.js";
import { cognitoTokenFixture, scope, token } from "./adapters/cognito-token.fixture.js";
import { stateDynamoFixture, conversationId, stateMetadata, stateProfile } from "./adapters/state-dynamodb.fixture.js";

const event = (path: string, body: object, access?: string) => ({ rawPath: path, requestContext: { http: { method: "POST" } }, headers: access ? { authorization: `Bearer ${access}` } : {}, body: JSON.stringify(body) });
describe("authenticated Conversation and Profile HTTP APIs", () => {
  it("uses the verified owner for conversation create/get/list/history/delete and keeps foreign state indistinguishable", async () => {
    const f = stateDynamoFixture(), { verifier } = cognitoTokenFixture(), auth = createHttpPrincipalResolver(verifier, [scope]);
    const app = new ConversationApplication(f.conversations, () => conversationId), handler = createConversationApiHandler(app, auth);
    const create = await handler(event("/api/conversations/v1", { version: "conversation-api-v1", operation: "create", metadata: stateMetadata() }, token()));
    expect(create.statusCode).toBe(200); expect(JSON.parse(create.body).conversation.ownerSubject).toBeUndefined();
    await app.append(await verifier.verify(token()), conversationId, 0, [{ role: "user", text: "相談" }]);
    expect(JSON.parse((await handler(event("/api/conversations/v1", { version: "conversation-api-v1", operation: "list", page: {} }, token()))).body).items).toHaveLength(1);
    expect(JSON.parse((await handler(event("/api/conversations/v1", { version: "conversation-api-v1", operation: "history", conversationId, page: {} }, token()))).body).items[0].text).toBe("相談");
    const other = await handler(event("/api/conversations/v1", { version: "conversation-api-v1", operation: "get", conversationId }, token({ sub: "B" })));
    const missing = await handler(event("/api/conversations/v1", { version: "conversation-api-v1", operation: "get", conversationId: "22222222-2222-4222-8222-222222222222" }, token({ sub: "B" })));
    expect(other.statusCode).toBe(404); expect(other.body).toBe(missing.body);
    const bHandler = createConversationApiHandler(new ConversationApplication(f.conversations, () => conversationId), auth);
    expect((await bHandler(event("/api/conversations/v1", { version: "conversation-api-v1", operation: "create", metadata: stateMetadata() }, token({ sub: "B" })))).statusCode).toBe(200);
    expect(JSON.parse((await bHandler(event("/api/conversations/v1", { version: "conversation-api-v1", operation: "list", page: {} }, token({ sub: "B" })))).body).items).toHaveLength(1);
    expect((await handler(event("/api/conversations/v1", { version: "conversation-api-v1", operation: "delete", conversationId, expectedRevision: 1 }, token()))).statusCode).toBe(200);
  });
  it("rejects malformed or unauthenticated conversation commands before state access", async () => {
    const f = stateDynamoFixture(), { verifier } = cognitoTokenFixture(), handler = createConversationApiHandler(new ConversationApplication(f.conversations), createHttpPrincipalResolver(verifier, [scope]));
    for (const [body, access, status] of [[{ version: "conversation-api-v1", operation: "list", page: {}, ownerId: "forged" }, token(), 400], [{ version: "conversation-api-v1", operation: "append" }, token(), 400], [{ version: "conversation-api-v1", operation: "list", page: {} }, undefined, 401], [{ version: "conversation-api-v1", operation: "list", page: {} }, token({ scope: "openid" }), 403]] as const) {
      expect((await handler(event("/api/conversations/v1", body, access))).statusCode).toBe(status);
    }
    expect(f.commands).toHaveLength(0);
  });
  it("returns missing Profile normally, CAS updates only its verified owner's Profile, and authenticates first", async () => {
    const f = stateDynamoFixture(), { verifier } = cognitoTokenFixture(), handler = createProfileApiHandler(new ProfileApplication(f.profiles, f.clock), createHttpPrincipalResolver(verifier, [scope]));
    expect(JSON.parse((await handler(event("/api/profile/v1", { version: "profile-api-v1", operation: "get" }, token()))).body).profile).toBeNull();
    const saved = await handler(event("/api/profile/v1", { version: "profile-api-v1", operation: "update", profile: stateProfile(), expectedRevision: null }, token()));
    expect(JSON.parse(saved.body).revision).toBe(0);
    expect(JSON.parse((await handler(event("/api/profile/v1", { version: "profile-api-v1", operation: "get" }, token({ sub: "B" })))).body).profile).toBeNull();
    expect((await handler(event("/api/profile/v1", { version: "profile-api-v1", operation: "update", profile: stateProfile(), expectedRevision: 1 }, token()))).statusCode).toBe(409);
    expect((await handler(event("/api/profile/v1", { version: "profile-api-v1", operation: "get" }))).statusCode).toBe(401);
  });
});
