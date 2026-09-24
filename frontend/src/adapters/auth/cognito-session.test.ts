// @vitest-environment happy-dom
import { webcrypto, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoSession, type AuthBrowser } from "./cognito-session";
import { parseAuthConfig, safeReturnPath } from "./auth-config";

const origin = "https://app.example.test";
const config = {
  issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_example",
  clientId: "exampleclient", loginOrigin: "https://example.auth.ap-northeast-1.amazoncognito.com",
  scopes: ["openid", "email", "raiquora/user"],
  callbackUrls: [`${origin}/index.html`], logoutUrls: [`${origin}/`],
};
let now: number;
function browser(href = `${origin}/?prompt=private#trip-share=secret`): AuthBrowser {
  const url = new URL(href);
  return { storage: sessionStorage, location: { href, origin, pathname: url.pathname, assign: vi.fn() },
    history: { replaceState: vi.fn() }, now: () => now, nonce: () => "test-random-nonce" };
}
async function login() {
  const b = browser();
  const auth = createCognitoSession(config, b);
  await auth.login();
  const request = new URL(vi.mocked(b.location.assign).mock.calls[0]![0]);
  const callback = `${origin}/index.html?code=one-time-code&state=${request.searchParams.get("state")}`;
  return { b, auth, request, callback };
}
function mockTokens(overrides: Record<string, unknown> = {}, claims: Record<string, unknown> = {}) {
  const profile = { iss: config.issuer, sub: "test-user", aud: config.clientId,
    exp: Math.floor(now / 1000) + 300, nonce: "test-random-nonce", email: "user@example.test", ...claims };
  const idToken = `${btoa(JSON.stringify({ alg: "RS256" }))}.${btoa(JSON.stringify(profile))}.fixture`;
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id_token: idToken, access_token: "access-token-fixture", refresh_token: "refresh-token-fixture",
    token_type: "Bearer", scope: config.scopes.join(" "), expires_in: 300, ...overrides,
  }), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function refreshedTokens(accessToken = "access-token-refreshed", refreshToken?: string) {
  return new Response(JSON.stringify({ access_token: accessToken, ...(refreshToken ? { refresh_token: refreshToken } : {}),
    token_type: "Bearer", scope: config.scopes.join(" "), expires_in: 300 }), { headers: { "Content-Type": "application/json" } });
}
beforeEach(() => { sessionStorage.clear(); now = Date.now(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Cognito public-client authentication", () => {
  it("uses code + S256 PKCE, state, nonce, Japanese Managed Login and no secret/private return URL", async () => {
    const { request } = await login();
    expect(request.origin).toBe(config.loginOrigin);
    expect(request.searchParams.get("response_type")).toBe("code");
    expect(request.searchParams.get("code_challenge_method")).toBe("S256");
    expect(request.searchParams.get("nonce")).toBe("test-random-nonce");
    expect(request.searchParams.get("lang")).toBe("ja");
    expect(request.href).not.toMatch(/secret|private|prompt=/);
    expect(request.searchParams.get("client_secret")).toBeNull();
    expect(request.searchParams.get("scope")).toContain("raiquora/user");
    const stored = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
    expect(request.searchParams.get("code_challenge")).toBe(createHash("sha256").update(stored.code_verifier).digest("base64url"));
  });

  it("scrubs callback first, stores a tab-only refresh session and restores it safely", async () => {
    const { callback } = await login();
    const fetchMock = mockTokens();
    const b = browser(callback), auth = createCognitoSession(config, b);
    await auth.initialize();
    expect(auth.getState()).toEqual({ status: "signed-in", displayName: "user@example.test", sessionExpiresAt: now + 8 * 60 * 60 * 1000 });
    expect(await auth.getAccessToken()).toBe("access-token-fixture");
    expect(b.history.replaceState).toHaveBeenLastCalledWith(null, "", "/");
    expect(vi.mocked(b.history.replaceState).mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get("code_verifier")).toBeTruthy();
    expect(body.get("client_id")).toBe(config.clientId);
    expect(body.get("redirect_uri")).toBe(`${origin}/index.html`);
    expect(body.has("client_secret")).toBe(false);
    expect(JSON.stringify(sessionStorage)).toContain("refresh-token-fixture");
    expect(JSON.stringify(sessionStorage)).not.toMatch(/id_token|test-random-nonce|one-time-code/);
    expect(JSON.stringify(localStorage)).not.toContain("refresh-token-fixture");
    const reloaded = createCognitoSession(config, browser());
    await reloaded.initialize();
    expect(await reloaded.getAccessToken()).toBe("access-token-fixture");
    now += 271_000; fetchMock.mockResolvedValueOnce(refreshedTokens());
    expect(await reloaded.getAccessToken()).toBe("access-token-refreshed");
    const refreshBody = fetchMock.mock.calls.at(-1)![1].body as URLSearchParams;
    expect(refreshBody.get("grant_type")).toBe("refresh_token");
    expect(refreshBody.get("refresh_token")).toBe("refresh-token-fixture");
    expect(refreshBody.has("client_secret")).toBe(false);
    expect(JSON.stringify(fetchMock.mock.calls.at(-1))).not.toContain("id_token");
  });

  it("single-flights concurrent refreshes, rotates the token atomically and never extends the eight-hour deadline", async () => {
    const { callback } = await login(); const fetchMock = mockTokens();
    const auth = createCognitoSession(config, browser(callback)); await auth.initialize();
    const stored = JSON.parse(sessionStorage.getItem(`raiquora.auth.${config.clientId}.session`)!) as { absoluteExpiresAt: number };
    now += 271_000;
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
    const left = auth.getAccessToken(), right = auth.getAccessToken();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    finish(refreshedTokens("rotated-access", "rotated-refresh"));
    expect(await Promise.all([left, right])).toEqual(["rotated-access", "rotated-access"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const updated = JSON.parse(sessionStorage.getItem(`raiquora.auth.${config.clientId}.session`)!) as { refreshToken: string; absoluteExpiresAt: number };
    expect(updated.refreshToken).toBe("rotated-refresh"); expect(updated.absoluteExpiresAt).toBe(stored.absoluteExpiresAt);
    now = stored.absoluteExpiresAt;
    expect(await auth.getAccessToken()).toBeUndefined(); expect(auth.getState().status).toBe("expired");
  });

  it("expires once on invalid_grant and does not retry refresh", async () => {
    const { callback } = await login(); const fetchMock = mockTokens();
    const auth = createCognitoSession(config, browser(callback)); await auth.initialize();
    now += 271_000;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant", error_description: "private" }), { status: 400 }));
    expect(await Promise.all([auth.getAccessToken(), auth.getAccessToken()])).toEqual([undefined, undefined]);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(auth.getState().status).toBe("expired");
    expect(JSON.stringify(sessionStorage)).not.toMatch(/refresh-token-fixture|private/);
  });

  it.each(["nonce", "iss", "aud", "exp"])("rejects invalid ID claim %s without retaining tokens", async key => {
    const { callback } = await login();
    mockTokens({}, { [key]: key === "exp" ? 1 : "wrong" });
    const auth = createCognitoSession(config, browser(callback));
    await auth.initialize();
    expect(auth.getState().status).toBe("error");
    expect(await auth.getAccessToken()).toBeUndefined();
  });

  it.each([{ scope: "openid email" }, { id_token: undefined }, { expires_in: -1 }, { expires_in: 3600 }, { token_type: "MAC" }])("rejects invalid token response %j", async overrides => {
    const { callback } = await login(); mockTokens(overrides);
    const auth = createCognitoSession(config, browser(callback)); await auth.initialize();
    expect(auth.getState().status).toBe("error");
  });

  it("rejects missing/mismatched state, wrong callback, duplicate code and expired transaction before token exchange", async () => {
    const { callback } = await login(); const fetchMock = mockTokens();
    for (const href of [callback.replace(/state=.*/, "state=wrong"), callback.replace("index.html", "elsewhere"),
      callback + "&code=duplicate", `${origin}/index.html?code=no-state`]) {
      const auth = createCognitoSession(config, browser(href)); await auth.initialize();
      expect(auth.getState().status).toBe("error");
    }
    now += 601_000;
    const auth = createCognitoSession(config, browser(callback)); await auth.initialize();
    expect(auth.getState().status).toBe("error"); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consumes state once and rejects callback replay", async () => {
    const { callback } = await login(); const fetchMock = mockTokens();
    await createCognitoSession(config, browser(callback)).initialize();
    const replay = createCognitoSession(config, browser(callback)); await replay.initialize();
    expect(replay.getState().status).toBe("error"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles provider cancellation and exchange failure without leaking details", async () => {
    const { callback } = await login(); const fetchMock = mockTokens();
    const auth = createCognitoSession(config, browser(callback.replace("code=one-time-code", "error=access_denied&error_description=private")));
    await auth.initialize(); expect(auth.getState()).toEqual({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
    const next = await login(); fetchMock.mockRejectedValue(new Error("private token error"));
    const failed = createCognitoSession(config, browser(next.callback)); await failed.initialize();
    expect(failed.getState()).toEqual({ status: "error" });
  });

  it("clears local tokens and pending state before revocation, then uses Cognito logout even if revoke fails", async () => {
    const { callback } = await login(); const fetchMock = mockTokens();
    const b = browser(callback), auth = createCognitoSession(config, b); await auth.initialize();
    fetchMock.mockImplementation(async () => {
      expect(await auth.getAccessToken()).toBeUndefined();
      expect(sessionStorage.length).toBe(0);
      throw new Error("revocation offline");
    });
    await auth.logout();
    const target = new URL(vi.mocked(b.location.assign).mock.calls[0]![0]);
    expect(target.pathname).toBe("/logout"); expect(target.searchParams.get("logout_uri")).toBe(`${origin}/`);
    expect(target.href).not.toMatch(/access-token|refresh-token|id_token/);
    expect(auth.getState().status).toBe("signed-out");
  });

  it("does not let an in-flight exchange restore a logged-out session", async () => {
    const { callback } = await login();
    const fetchMock = mockTokens(); const response = await fetchMock();
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const auth = createCognitoSession(config, browser(callback));
    const pending = auth.initialize();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await auth.logout(); resolve(response); await pending;
    expect(await auth.getAccessToken()).toBeUndefined(); expect(auth.getState().status).toBe("signed-out");
  });
});

it("validates config and allows only known document paths for return-to", () => {
  expect(parseAuthConfig(config, origin)).toEqual(config);
  expect(() => parseAuthConfig({ ...config, callbackUrls: [] }, origin)).toThrow();
  expect(() => parseAuthConfig({ ...config, loginOrigin: "http://evil.test" }, origin)).toThrow();
  for (const path of ["//evil.test", "https://evil.test", "/\\evil", "/?token=secret", "/#trip-share=secret", "/unknown", null]) expect(safeReturnPath(path)).toBe("/");
  expect(safeReturnPath("/index.html")).toBe("/index.html");
});

it("invalidates rejected API credentials locally without logout navigation or automatic retry", async () => {
  const { callback } = await login(); mockTokens();
  const b = browser(callback), auth = createCognitoSession(config, b); await auth.initialize();
  auth.invalidate();
  expect(auth.getState().status).toBe("expired");
  expect(await auth.getAccessToken()).toBeUndefined();
  expect(sessionStorage.length).toBe(0); expect(b.location.assign).not.toHaveBeenCalled();
});
