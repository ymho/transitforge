import { createHttpPrincipalResolver } from "../http-auth-composition.js";
import { describe, expect, it, vi } from "vitest";
import { accessTokenFromHttp, authenticationErrorResponse, httpMethod } from "./http-api-auth.js";
import { cognitoTokenFixture, token, scope } from "./cognito-token.fixture.js";
import { AuthenticationError } from "../contracts/trusted-principal.js";

describe("HTTP Cognito authentication adapter", () => {
  it("accepts one Bearer including v1's identical single/multi representation", () => {
    expect(accessTokenFromHttp({ headers: { Authorization: "bEaReR access.token" } })).toBe("access.token");
    expect(accessTokenFromHttp({ headers: { authorization: "Bearer access" }, multiValueHeaders: { Authorization: ["Bearer access"] } })).toBe("access");
    expect(accessTokenFromHttp({ multiValueHeaders: { AUTHORIZATION: ["Bearer access"] } })).toBe("access");
    expect(httpMethod({ httpMethod: "POST" })).toBe("POST");
    expect(httpMethod({ httpMethod: "GET", requestContext: { http: { method: "POST" } } })).toBeUndefined();
  });
  it.each([
    {}, { headers: { authorization: "" } }, { headers: { authorization: "Basic private" } },
    { headers: { authorization: "AWS4-HMAC-SHA256 private" } },
    { headers: { authorization: "Bearer a, Bearer a" } },
    { headers: { Authorization: "Bearer a", authorization: "Bearer a" } },
    { headers: { authorization: "Bearer a" }, multiValueHeaders: { authorization: ["Bearer b"] } },
    { multiValueHeaders: { authorization: ["Bearer a", "Bearer a"] } },
    { multiValueHeaders: { authorization: [] } },
    { multiValueHeaders: { Authorization: ["Bearer a"], authorization: ["Bearer a"] } },
    { headers: { authorization: "Bearer a\r\nprivate" } },
    { headers: { authorization: "Bearer a other" } },
    { headers: { "x-user-id": "owner", "x-forwarded-authorization": "Bearer a" } },
    { headers: { authorization: `Bearer ${"x".repeat(16385)}` } },
  ])("rejects absent/ambiguous/unsupported transport without exposing values (%#)", event => {
    expect(() => accessTokenFromHttp(event)).toThrow("unauthenticated");
  });
  it("uses #484 verification and all-of scope policy, with sanitized 401/403", async () => {
    const { verifier } = cognitoTokenFixture();
    const resolve = createHttpPrincipalResolver(verifier, [scope]);
    const p = await resolve({ headers: { authorization: `Bearer ${token()}`, ownerId: "forged" } });
    expect(p.subject).toMatch(/^identity-v1:/);
    for (const access of [token({ exp: 1 }), token({ token_use: "id" }), "forged.token"]) {
      await expect(resolve({ headers: { authorization: `Bearer ${access}` } })).rejects.toMatchObject({ code: "unauthenticated" });
    }
    await expect(resolve({ headers: { authorization: `Bearer ${token({ scope: "openid" })}` } })).rejects.toMatchObject({ code: "forbidden" });
    for (const code of ["unauthenticated", "forbidden"] as const) {
      const r = authenticationErrorResponse(new AuthenticationError(code), "test-v1")!;
      expect(r.statusCode).toBe(code === "unauthenticated" ? 401 : 403);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(JSON.parse(r.body)).toEqual({ version: "test-v1", error: code });
    }
    const execute = vi.fn();
    expect(() => createHttpPrincipalResolver({ verify: execute }, [])).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
