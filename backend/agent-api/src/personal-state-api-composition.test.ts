import { describe, expect, it } from "vitest";
import { createPersonalStateApiHandler } from "./personal-state-api-composition.js";
import { cognitoTokenFixture, pool, scope, token } from "./adapters/cognito-token.fixture.js";

const event = (path: string, access?: string) => ({ rawPath: path, requestContext: { http: { method: "POST" } }, headers: access ? { authorization: `Bearer ${access}` } : {}, body: JSON.stringify({ version: path.includes("profile") ? "profile-api-v1" : "conversation-api-v1", operation: "get" }) });
describe("production personal state host", () => {
  it("exposes only Conversation/Profile routes and never opens Trip routes", async () => {
    const host = createPersonalStateApiHandler({ enabled: true, auth: { userPoolId: pool, clientId: "app-client", requiredScopes: [scope] }, stateTable: "state", verifier: cognitoTokenFixture().verifier });
    expect((await host(event("/api/trips/v1", token()))).statusCode).toBe(404);
    expect((await host(event("/api/conversations/v1"))).statusCode).toBe(401);
    expect((await host(event("/api/profile/v1", token({ scope: "openid" })))).statusCode).toBe(403);
  });
  it("fails closed before creating an auth/verifier host", async () => {
    const host = createPersonalStateApiHandler({ enabled: false, auth: { userPoolId: "", clientId: "", requiredScopes: [scope] }, stateTable: "" });
    expect((await host(event("/api/conversations/v1"))).statusCode).toBe(503);
  });
});
