/** Real built Viewer in Chromium; synthetic auth/API only, no Cognito account or model. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const root = resolve("dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(`${root}/`)) throw new Error("Invalid path");
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }); response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const config = { issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_fixture",
  clientId: "startupfixture", loginOrigin: "https://startup.auth.ap-northeast-1.amazoncognito.com",
  scopes: ["openid", "email", "raiquora/user"], callbackUrls: [`${origin}/index.html`], logoutUrls: [`${origin}/`] };
const key = `raiquora.auth.${config.clientId}.session`;
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [], apiCalls = [], dataCalls = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) apiCalls.push(url.pathname);
      if (/viewer-input|\/api\/traffic|mapbox|three-/.test(url.pathname + url.hostname)) dataCalls.push(url.pathname);
    });
    await page.route("**/auth-config.json", route => route.fulfill({ json: config }));
    await page.route("**/api/**", route => {
      assert.equal(route.request().headers().authorization, "Bearer fixture-access");
      const path = new URL(route.request().url()).pathname;
      const json = path === "/api/profile/v1" ? { version: "profile-api-v1", profile: null }
        : path === "/api/trips/v1" ? { version: "trip-api-v1", trips: [] } : { version: "conversation-api-v1", items: [] };
      return route.fulfill({ json });
    });
    async function ready() {
      await page.waitForSelector('#app[data-primary-view="chat"]');
      await page.waitForFunction(() => !document.getElementById("startup-status"));
      assert.equal(await page.locator("#app").evaluate(element => getComputedStyle(element).visibility), "visible");
      assert.equal(await page.locator("[data-home-hero]").isVisible(), true);
      assert.equal(await page.locator("#home-prompt").isVisible(), true);
    }
    for (const path of ["/", "/index.html", "/#chat", "/#trip", "/#trips", "/#map", "/#my"]) {
      await page.goto(origin + path); await ready();
      assert.equal(new URL(page.url()).hash, "#chat");
      await page.reload(); await ready();
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow"))); await ready();
    }
    assert.deepEqual(apiCalls, []); assert.deepEqual(dataCalls, []); assert.deepEqual(errors, []);

    // Restore after eight hours using real auth refresh and full Viewer composition.
    await page.clock.install({ time: new Date("2026-10-04T00:00:00Z") });
    const now = Date.parse("2026-10-04T00:00:00Z"), issuedAt = now - 9 * 60 * 60 * 1000;
    await page.evaluate(({ key, config, issuedAt }) => sessionStorage.setItem(key, JSON.stringify({ version: 1,
      issuer: config.issuer, clientId: config.clientId, scopes: config.scopes, accessToken: "old-access",
      refreshToken: "fixture-refresh", issuedAt, expiresAt: issuedAt + 300_000,
      absoluteExpiresAt: issuedAt + 12 * 60 * 60 * 1000, displayName: "fixture user" })), { key, config, issuedAt });
    let refreshes = 0;
    await page.route(`${config.loginOrigin}/oauth2/token`, route => {
      refreshes++;
      assert.equal(new URLSearchParams(route.request().postData()).get("grant_type"), "refresh_token");
      return route.fulfill({ headers: { "access-control-allow-origin": origin }, json: { access_token: "fixture-access", token_type: "Bearer", expires_in: 300, scope: config.scopes.join(" ") } });
    });
    await page.goto(origin + "/"); await ready();
    assert.equal(refreshes, 1);
    await page.locator("[data-account]").click();
    await page.waitForSelector('[data-primary-view="my"]');
    assert.match(await page.locator("[data-my-account-status]").textContent(), /ログイン中/);
    await page.reload(); await page.waitForSelector('[data-primary-view="my"]');
    await page.waitForFunction(() => !document.getElementById("startup-status"));
    assert.equal(refreshes, 1);

    // Resume a suspended tab after its absolute deadline: no refresh or protected data.
    const beforeExpiry = apiCalls.length;
    await page.clock.setSystemTime(new Date(issuedAt + 12 * 60 * 60 * 1000));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow"))); await ready();
    assert.equal(refreshes, 1); assert.equal(apiCalls.length, beforeExpiry);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
    await page.reload(); await ready();
    assert.deepEqual(dataCalls, []); assert.deepEqual(errors, []);

    // Explicit logout clears tab credentials before Cognito navigation, then Home still mounts.
    const logoutTime = issuedAt + 12 * 60 * 60 * 1000;
    await page.evaluate(({ key, config, logoutTime }) => sessionStorage.setItem(key, JSON.stringify({ version: 1,
      issuer: config.issuer, clientId: config.clientId, scopes: config.scopes, accessToken: "fixture-access",
      refreshToken: "fixture-refresh", issuedAt: logoutTime, expiresAt: logoutTime + 300_000,
      absoluteExpiresAt: logoutTime + 12 * 60 * 60 * 1000, displayName: "fixture user" })), { key, config, logoutTime });
    await page.route(`${config.loginOrigin}/oauth2/revoke`, route => route.fulfill({ body: "", status: 200, headers: { "access-control-allow-origin": origin } }));
    await page.route(`${config.loginOrigin}/logout?*`, route => route.fulfill({ status: 302, headers: { location: origin + "/" } }));
    await page.reload(); await ready();
    await page.locator("[data-account]").click(); await page.waitForSelector('[data-primary-view="my"]');
    await Promise.all([page.waitForEvent("load"), page.locator("[data-my-logout]").click()]); await ready();
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
    assert.deepEqual(errors, []); assert.deepEqual(dataCalls, []);

    // A failed dynamic import must display recovery; reload retries the actual build.
    await page.route("**/viewer-composition-*.js", route => route.abort());
    await page.goto(origin + "/");
    await page.waitForSelector('#startup-status[role="alert"]');
    assert.equal(await page.locator("#startup-status button").isVisible(), true);
    assert.equal(await page.locator("#app").isVisible(), false);
    await page.unroute("**/viewer-composition-*.js");
    await page.locator("#startup-status button").click(); await ready();
    await context.close();
    console.log(`Built Viewer startup verified at ${viewport.width}px: first load/reload, protected routes, 12h expiry and import recovery.`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
