import { randomBytes, randomUUID } from "node:crypto";
import { Log, OidcClient, WebStorageStateStore, InMemoryWebStorage } from "oidc-client-ts";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { requireCheck } from "./safety.mjs";

export async function newLogin(config) {
  // ADR 0069: reuse the SPA's library for PKCE/state/nonce and one-use exchange.
  Log.setLevel(Log.NONE);
  const client = new OidcClient({ authority: config.issuer, client_id: config.clientId,
    redirect_uri: config.callbackUrl, response_type: "code", response_mode: "query",
    scope: "openid email raiquora/user", loadUserInfo: false, filterProtocolClaims: false,
    staleStateAgeInSeconds: 600, requestTimeoutInSeconds: 15,
    stateStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    metadata: { issuer: config.issuer, authorization_endpoint: `${config.loginOrigin}/oauth2/authorize`,
      token_endpoint: `${config.loginOrigin}/oauth2/token` },
  });
  const request = await client.createSigninRequest({ nonce: randomUUID(), prompt: "login" });
  return { client, verifier: request.state.code_verifier, state: request.state.id, url: request.url };
}
export function callbackCode(href, callbackUrl, state) {
  const url = new URL(href);
  requireCheck(`${url.origin}${url.pathname}` === callbackUrl && !url.hash && !url.searchParams.has("error"));
  requireCheck(url.searchParams.getAll("state").length === 1 && url.searchParams.get("state") === state);
  requireCheck(url.searchParams.getAll("code").length === 1 && Boolean(url.searchParams.get("code")));
  return url.searchParams.get("code");
}
export function tokenResponse(value) {
  requireCheck(typeof value.access_token === "string" && value.access_token.length > 0 && value.access_token.length <= 16384);
  requireCheck(value.token_type?.toLowerCase() === "bearer" && Number.isFinite(value.expires_in) && value.expires_in > 0 && value.expires_in <= 300);
  requireCheck(["openid", "email", "raiquora/user"].every(scope => value.scope?.split(" ").includes(scope)));
  return value.access_token;
}

export async function login(browser, config, user) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const pending = await newLogin(config);
  let callback;
  // Intercept before the viewer/server receives the code. No trace, HAR, screenshot,
  // console forwarding, persisted browser profile or Playwright test reporter.
  await page.route(`${config.callbackUrl}*`, async route => {
    callback = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Validation</title>" });
  });
  try {
    await page.goto(pending.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('input[name="username"]:visible').fill(user.username);
    await page.locator('input[name="password"]:visible').fill(user.password);
    await page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first().click();
    await page.waitForURL(url => `${url.origin}${url.pathname}` === config.callbackUrl, { timeout: 60_000 });
    callbackCode(callback, config.callbackUrl, pending.state);
    const response = await pending.client.processSigninResponse(callback);
    requireCheck(response.id_token && response.profile.iss === config.issuer && response.profile.aud === config.clientId &&
      Number.isFinite(response.profile.exp) && response.profile.exp * 1000 > Date.now());
    return tokenResponse(response);
  } catch { throw new Error("PKCE validation failed"); }
  finally { await context.close(); }
}

export function ledgerPath(env = process.env) {
  requireCheck(env.RUNNER_TEMP && /^\d+$/u.test(env.GITHUB_RUN_ID ?? "") && /^\d+$/u.test(env.GITHUB_RUN_ATTEMPT ?? ""));
  return `${env.RUNNER_TEMP}/cutover-users-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}.json`;
}
function save(path, ledger) { writeFileSync(path, JSON.stringify(ledger), { mode: 0o600 }); }
export async function createUsers(call, config, path) {
  requireCheck(!existsSync(path));
  const ledger = { pool: config.userPoolId, started: Date.now(), nonce: randomUUID(), users: [] };
  writeFileSync(path, JSON.stringify(ledger), { mode: 0o600, flag: "wx" });
  const users = [];
  for (const suffix of ["a", "b"]) {
    const username = `cutover-${ledger.nonce}-${suffix}@example.invalid`;
    requireCheck(await call("cognito-idp", "admin-get-user", { UserPoolId: ledger.pool, Username: username }, { missing: true }) === undefined);
    // Persist intent before create, so response loss still has an exact cleanup target.
    ledger.users.push(username); save(path, ledger);
    const password = `Aa1!${randomBytes(36).toString("base64url")}`;
    await call("cognito-idp", "admin-create-user", { UserPoolId: ledger.pool, Username: username, MessageAction: "SUPPRESS",
      TemporaryPassword: `Aa1!${randomBytes(36).toString("base64url")}`,
      UserAttributes: [{ Name: "email", Value: username }, { Name: "email_verified", Value: "true" }] });
    // Only this newly created temporary user; never alter pool/client auth settings.
    await call("cognito-idp", "admin-set-user-password", { UserPoolId: ledger.pool, Username: username, Password: password, Permanent: true });
    users.push({ username, password });
  }
  return users;
}
export function validLedger(ledger, pool) {
  requireCheck(ledger.pool === pool && /^[0-9a-f-]{36}$/u.test(ledger.nonce) && Number.isFinite(ledger.started));
  requireCheck(Array.isArray(ledger.users) && ledger.users.length <= 2 && new Set(ledger.users).size === ledger.users.length);
  requireCheck(ledger.users.every(name => ["a", "b"].some(suffix => name === `cutover-${ledger.nonce}-${suffix}@example.invalid`)));
}
export async function cleanupUsers(call, config, path) {
  if (!existsSync(path)) return;
  const ledger = JSON.parse(readFileSync(path, "utf8")); validLedger(ledger, config.userPoolId);
  let failed = false;
  for (const username of [...ledger.users]) {
    try {
      const user = await call("cognito-idp", "admin-get-user", { UserPoolId: ledger.pool, Username: username }, { missing: true });
      if (user) {
        requireCheck(user.UserAttributes?.some(entry => entry.Name === "email" && entry.Value === username));
        requireCheck(Date.parse(user.UserCreateDate) >= ledger.started - 5000);
        await call("cognito-idp", "admin-delete-user", { UserPoolId: ledger.pool, Username: username });
      }
      ledger.users = ledger.users.filter(name => name !== username); save(path, ledger);
    } catch { failed = true; }
  }
  requireCheck(!failed);
  unlinkSync(path);
}
