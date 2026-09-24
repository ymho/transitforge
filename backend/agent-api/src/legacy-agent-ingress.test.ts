import { describe, expect, it, vi } from "vitest";
import { createAgentApiHandler } from "./handler.js";
import { authorizeLegacyAgentRequest } from "./legacy-agent-ingress.js";
import { cognitoTokenFixture, token } from "./adapters/cognito-token.fixture.js";
import type { LambdaHttpEvent } from "./contracts/http.js";

function fixture() {
  const execute = vi.fn(async () => ({ body: { ok: true } }));
  const { verifier } = cognitoTokenFixture();
  return { execute, handler: createAgentApiHandler({ execute }, { authorize: authorizeLegacyAgentRequest(verifier) }) };
}
function post(value: unknown, access?: string): LambdaHttpEvent {
  return { rawPath: "/api/agent", requestContext: { http: { method: "POST" } },
    headers: access ? { "x-raiquora-access-token": `Bearer ${access}` } : {}, body: JSON.stringify(value) };
}

describe("production legacy ingress closure", () => {
  it.each([undefined, null, 1, "", "bedrock_converse", "unknown", "constructor", "agent_trace", "conversation_feedback"])(
    "rejects operation %s before any application/model/tool, with or without valid authentication", async operation => {
      const f = fixture();
      for (const access of [undefined, "forged", token()]) {
        const event = post({ operation, messages: [{ role: "user", content: [{ text: "hello" }] }] }, access);
        for (const path of ["/api/agent", "/", "/unrecognized"]) {
          const result = await f.handler({ ...event, rawPath: path });
          expect(result.statusCode).toBe(410);
          expect(result.headers["cache-control"]).toBe("no-store");
        }
      }
      expect(f.execute).not.toHaveBeenCalled();
    });
  it("rejects encoded old requests and conversation fields hidden in allowed operations", async () => {
    const f = fixture(), event = post({ messages: [] });
    expect((await f.handler({ ...event, isBase64Encoded: true, body: Buffer.from(event.body!).toString("base64") })).statusCode).toBe(410);
    for (const operation of ["place_detail_research", "weather_grid_search"]) {
      for (const key of ["messages", "toolDefinitions", "modelClass", "modelCallId"]) {
        expect((await f.handler(post({ operation, [key]: [] }, token()))).statusCode).toBe(400);
      }
    }
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("authenticates paid operations with the existing Cognito contract before execution", async () => {
    const f = fixture();
    for (const access of [undefined, "forged", token({ exp: 1 }), token({ client_id: "other" }),
      token({ iss: "https://other.invalid" }), token({ token_use: "id" })]) {
      const result = await f.handler(post({ operation: "place_detail_research" }, access));
      expect(result.statusCode).toBe(401);
      expect(result.headers["www-authenticate"]).toBe("Bearer");
      expect(result.body).not.toContain(access ?? "secret");
    }
    expect((await f.handler(post({ operation: "web_search" }, token({ scope: "openid" })))).statusCode).toBe(403);
    expect(f.execute).not.toHaveBeenCalled();
    expect((await f.handler(post({ operation: "place_detail_research", query: "Kyoto" }, token()))).statusCode).toBe(200);
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it("does not trust IAM/Basic, forwarded identity, duplicate or conflicting token headers", async () => {
    const f = fixture(), bearer = `Bearer ${token()}`, event = post({ operation: "journey_search" });
    for (const headers of [
      { authorization: bearer }, { "x-forwarded-authorization": bearer, "x-user-id": "user-a" },
      { "x-raiquora-access-token": `${bearer},${bearer}` },
      { "x-raiquora-access-token": bearer, "X-Raiquora-Access-Token": bearer },
    ]) expect((await f.handler({ ...event, headers })).statusCode).toBe(401);
    expect((await f.handler({ ...event, headers: { "x-raiquora-access-token": bearer },
      multiValueHeaders: { "x-raiquora-access-token": ["Bearer other"] } })).statusCode).toBe(401);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("requires the same Cognito contract for map weather", async () => {
    const f = fixture();
    for (const operation of ["weather_grid_search", "weather_forecast_search"]) {
      expect((await f.handler(post({ operation }))).statusCode).toBe(401);
      expect((await f.handler(post({ operation }, token()))).statusCode).toBe(200);
    }
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
});
