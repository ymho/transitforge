import { describe, expect, it } from "vitest";
import { createTripApiPublicHandler } from "./trip-api-composition.js";
import { cognitoTokenFixture, pool, scope, token } from "./adapters/cognito-token.fixture.js";

const event = (path: string, access?: string) => ({ rawPath: path, requestContext: { http: { method: "POST" } }, headers: access ? { authorization: `Bearer ${access}` } : {}, body: JSON.stringify({ version: "trip-api-v1", operation: "list" }) });
describe("public Trip API host", () => {
  it("requires an Access Token and exposes only the Trip writer route", async () => {
    const host = createTripApiPublicHandler({ enabled: true, auth: { userPoolId: pool, clientId: "app-client", requiredScopes: [scope] }, tripTable: "trips", stateTable: "state", verifier: cognitoTokenFixture().verifier });
    expect((await host(event("/api/trips/v1"))).statusCode).toBe(401);
    expect((await host(event("/api/trips/v1", token({ scope: "openid" })))).statusCode).toBe(403);
    expect((await host(event("/api/trips/sharing/v1", token()))).statusCode).toBe(404);
  });
});
