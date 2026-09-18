import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callbackCode, cleanupUsers, createUsers, login, newLogin, tokenResponse, validLedger } from "./cognito.mjs";

const config = { issuer: "https://issuer.invalid", userPoolId: "synthetic-pool", clientId: "synthetic-client", loginOrigin: "https://login.invalid", callbackUrl: "https://viewer.invalid/index.html" };
test("PKCE uses S256, random state/verifier, registered callback and required scopes", async () => {
  const a = await newLogin(config), b = await newLogin(config), url = new URL(a.url);
  assert.notEqual(a.state, b.state); assert.notEqual(a.verifier, b.verifier);
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(a.verifier).digest("base64url"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid email raiquora/user");
  assert.equal(url.searchParams.get("redirect_uri"), config.callbackUrl);
  assert.equal(callbackCode(`${config.callbackUrl}?code=synthetic&state=${a.state}`, config.callbackUrl, a.state), "synthetic");
  for (const suffix of ["?code=x&state=wrong", `?code=x&code=y&state=${a.state}`, `?code=x&state=${a.state}#fragment`, `?error=PRIVATE&state=${a.state}`]) {
    assert.throws(() => callbackCode(config.callbackUrl + suffix, config.callbackUrl, a.state), /validation failed/u);
  }
  assert.throws(() => callbackCode(`https://foreign.invalid/index.html?code=x&state=${a.state}`, config.callbackUrl, a.state));
});
test("token response must contain an Access Token and all scopes", () => {
  const good = { access_token: "synthetic-access", id_token: "synthetic-id", token_type: "Bearer", expires_in: 300, scope: "openid email raiquora/user" };
  assert.equal(tokenResponse(good), "synthetic-access");
  for (const patch of [{ access_token: undefined }, { scope: "openid" }, { expires_in: 0 }, { token_type: "other" }]) assert.throws(() => tokenResponse({ ...good, ...patch }));
});
test("Managed Login intercepts callback, exchanges code with verifier, closes context and sanitizes failures", async () => {
  let intercept, authorize, closed = 0, exchange = 0;
  const context = { close: async () => { closed++; }, newPage: async () => ({
    setDefaultTimeout() {}, route: async (_url, action) => { intercept = action; },
    goto: async url => { authorize = new URL(url); },
    locator: () => ({ fill: async () => {}, first: () => ({ click: async () => {
      await intercept({ request: () => ({ url: () => `${config.callbackUrl}?code=synthetic-code&state=${authorize.searchParams.get("state")}` }), fulfill: async () => {} });
    } }) }),
    waitForURL: async () => {},
  }) };
  const browser = { newContext: async () => context };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      exchange++;
      assert.equal(url, `${config.loginOrigin}/oauth2/token`);
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), "synthetic-code");
      assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), authorize.searchParams.get("code_challenge"));
      const encoded = value => Buffer.from(JSON.stringify(value)).toString("base64url");
      const id = `${encoded({ alg: "RS256" })}.${encoded({ iss: config.issuer, aud: config.clientId, sub: "synthetic-subject", exp: Math.floor(Date.now() / 1000) + 300, nonce: authorize.searchParams.get("nonce") })}.synthetic`;
      return Response.json({ access_token: "synthetic-access", id_token: id, token_type: "Bearer", expires_in: 300, scope: "openid email raiquora/user" });
    };
    const result = await login(browser, config, { username: "synthetic", password: "synthetic" });
    assert.equal(result, "synthetic-access"); assert.equal(exchange, 1); assert.equal(closed, 1);
    globalThis.fetch = async () => { throw new Error("PRIVATE password and code"); };
    await assert.rejects(login(browser, config, { username: "synthetic", password: "synthetic" }), /^Error: PKCE validation failed$/u);
    assert.equal(closed, 2);
  } finally { globalThis.fetch = originalFetch; }
});
test("ambiguous creation is recoverable; cleanup deletes only the current run's exact users and attempts both", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cutover-test-")), path = join(dir, "ledger.json");
  const users = new Map(), deleted = [], calls = [];
  let failSecond = true;
  const call = async (_service, operation, input) => {
    calls.push(operation);
    if (operation === "admin-get-user") return users.get(input.Username);
    if (operation === "admin-create-user") {
      users.set(input.Username, { UserCreateDate: new Date().toISOString(), UserAttributes: input.UserAttributes });
      if (users.size === 2 && failSecond) throw new Error("ambiguous create result");
    }
    if (operation === "admin-delete-user") { deleted.push(input.Username); users.delete(input.Username); }
    return {};
  };
  try {
    await assert.rejects(createUsers(call, config, path));
    const raw = readFileSync(path, "utf8"), ledger = JSON.parse(raw);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.doesNotMatch(raw, /password|token/iu);
    assert.equal(ledger.users.length, 2);
    assert.throws(() => validLedger({ ...ledger, users: ["existing@example.invalid"] }, config.userPoolId));
    assert.throws(() => validLedger(ledger, "other-pool"));
    await cleanupUsers(call, config, path);
    assert.equal(deleted.length, 2); assert.equal(existsSync(path), false);
    await cleanupUsers(call, config, path);
    assert.equal(deleted.length, 2);
    assert.ok(calls.includes("admin-set-user-password"));
    failSecond = false;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("cleanup refuses a pre-existing account and still cleans the other account", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cutover-test-")), path = join(dir, "ledger.json");
  const users = new Map();
  const call = async (_service, op, input) => {
    if (op === "admin-get-user") return users.get(input.Username);
    if (op === "admin-create-user") users.set(input.Username, { UserCreateDate: new Date().toISOString(), UserAttributes: input.UserAttributes });
    if (op === "admin-delete-user") users.delete(input.Username);
    return {};
  };
  try {
    const created = await createUsers(call, config, path);
    users.get(created[0].username).UserCreateDate = "2000-01-01T00:00:00Z";
    await assert.rejects(cleanupUsers(call, config, path));
    assert.equal(users.size, 1);
    assert.deepEqual(JSON.parse(readFileSync(path)).users, [created[0].username]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
