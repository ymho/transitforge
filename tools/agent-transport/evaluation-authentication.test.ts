import { expect, it, vi } from "vitest";
import { SigninResponse, type OidcClient } from "oidc-client-ts";
import { createEvaluationAuthentication } from "./evaluation-authentication.js";

const callback = "http://127.0.0.1:8788/index.html", subject = "11111111-1111-4111-8111-111111111111";
const config = { issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_TestPool", clientId: "testclient",
  loginOrigin: "https://test-login.auth.ap-northeast-1.amazoncognito.com", scopes: ["openid", "raiquora/user"],
  callbackUrls: [callback], logoutUrls: ["http://127.0.0.1:8788/"] };
const response = (access = "access-fixture") => Object.assign(new SigninResponse(new URLSearchParams()), {
  access_token: access, refresh_token: "refresh-fixture", token_type: "Bearer", expires_in: 300, scope: "openid raiquora/user",
  profile: { iss: config.issuer, aud: config.clientId, sub: subject } });
function fixture() {
  let clock = 1000000;
  const signed = response();
  const client = { createSigninRequest: vi.fn(async () => ({ url: `${config.loginOrigin}/oauth2/authorize` })),
    processSigninResponse: vi.fn(async () => signed), useRefreshToken: vi.fn(async () => response("refreshed-fixture")), revokeToken: vi.fn(async () => {}) };
  const verify = vi.fn(async () => ({ subject: "identity-fixture", identity: { issuer: config.issuer, subject }, scopes: ["raiquora/user"] }));
  const auth = createEvaluationAuthentication({ config, callback, expectedSubject: subject }, {
    client: client as unknown as Pick<OidcClient, "createSigninRequest" | "processSigninResponse" | "useRefreshToken" | "revokeToken">,
    verifier: { verify }, now: () => clock });
  return { auth, client, verify, signed, advance: (milliseconds: number) => { clock += milliseconds; } };
}

it("uses the installed OIDC library's Code/PKCE flow with process-local state", async () => {
  const auth = createEvaluationAuthentication({ config, callback, expectedSubject: subject });
  const url = new URL(await auth.begin());
  expect(url.origin).toBe(config.loginOrigin);
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("prompt")).toBe("login");
  expect(url.searchParams.get("redirect_uri")).toBe(callback);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toHaveLength(43);
  expect(url.searchParams.has("code_verifier")).toBe(false);
  await auth.close();
});

it("refreshes once concurrently and preserves the original absolute deadline", async () => {
  const f = fixture(); await f.auth.begin(); await f.auth.complete(`${callback}?code=fixture&state=fixture`);
  expect(await f.auth.token()).toBe("access-fixture");
  f.advance(271000);
  expect(await Promise.all([f.auth.token(), f.auth.token()])).toEqual(["refreshed-fixture", "refreshed-fixture"]);
  expect(f.client.useRefreshToken).toHaveBeenCalledTimes(1);
  f.advance(12 * 60 * 60 * 1000);
  await expect(f.auth.token()).rejects.toThrow("evaluation_auth_expired");
  await f.auth.close();
  expect(f.client.revokeToken).toHaveBeenCalledWith("refresh-fixture", "refresh_token");
});

it("rejects another user, missing scope and duplicated callback parameters", async () => {
  const wrong = fixture(); wrong.verify.mockResolvedValue({ subject: "other", identity: { issuer: config.issuer, subject: "other" }, scopes: ["raiquora/user"] });
  await wrong.auth.begin(); await expect(wrong.auth.complete(`${callback}?code=fixture&state=fixture`)).rejects.toThrow("evaluation_auth_rejected");
  await expect(wrong.auth.token()).rejects.toThrow("evaluation_auth_expired"); await wrong.auth.close();
  expect(wrong.client.revokeToken).toHaveBeenCalledTimes(1);
  const scope = fixture(); scope.verify.mockResolvedValue({ subject: "test", identity: { issuer: config.issuer, subject }, scopes: [] });
  await scope.auth.begin(); await expect(scope.auth.complete(`${callback}?code=fixture&state=fixture`)).rejects.toThrow("evaluation_auth_rejected");
  const duplicate = fixture(); await duplicate.auth.begin();
  await expect(duplicate.auth.complete(`${callback}?code=one&code=two&state=fixture`)).rejects.toThrow("evaluation_auth_rejected");
  expect(duplicate.client.processSigninResponse).not.toHaveBeenCalled();
});

it("refuses an expired login and removes the grant on shutdown", async () => {
  const f = fixture(); await f.auth.begin(); f.advance(600001);
  await expect(f.auth.complete(`${callback}?code=fixture&state=fixture`)).rejects.toThrow("evaluation_auth_unavailable");
  expect(f.client.processSigninResponse).not.toHaveBeenCalled(); await f.auth.close();
  const g = fixture(); await g.auth.begin(); await g.auth.complete(`${callback}?code=fixture&state=fixture`); await g.auth.close();
  await expect(g.auth.token()).rejects.toThrow("evaluation_auth_expired");
  await expect(g.auth.begin()).rejects.toThrow("evaluation_auth_unavailable");
});

it("keeps the grant after a temporary refresh failure and revokes a late refresh on shutdown", async () => {
  const f = fixture(); await f.auth.begin(); await f.auth.complete(`${callback}?code=fixture&state=fixture`); f.advance(271000);
  f.client.useRefreshToken.mockRejectedValueOnce(new Error("temporary-network-detail"));
  await expect(f.auth.token()).rejects.toThrow("evaluation_auth_refresh_unavailable");
  expect(await f.auth.token()).toBe("refreshed-fixture");
  let release: (value: SigninResponse) => void = () => {};
  f.advance(271000);
  f.client.useRefreshToken.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const refresh = f.auth.token();
  const closing = f.auth.close();
  const late = response("late-access-fixture"); late.refresh_token = "late-refresh-fixture";
  release(late);
  await expect(refresh).rejects.toThrow("evaluation_auth_refresh_unavailable"); await closing;
  expect(f.client.revokeToken).toHaveBeenCalledWith("late-refresh-fixture", "refresh_token");
});
