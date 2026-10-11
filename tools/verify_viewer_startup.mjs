/** Real built Viewer in Chromium; synthetic auth/API only, no Cognito account or model. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";

import { tripWeatherTargets, tripWeatherBasis } from "../modules/trip/domain/trip-weather.ts";
import { consultationDesignFixture } from "../frontend/src/presentation/concierge/consultation-design.fixture.ts";
import { officialGuideSnapshot } from "../modules/trip/domain/official-guide.ts";
import { createTrip, applyTripProposal } from "../modules/trip/domain/trip.ts";
import { railSelectionFixture } from "../modules/trip/domain/selected-rail-journey.fixture.ts";
import { selectRailJourney, projectRailSchedule } from "../modules/trip/domain/selected-rail-journey.ts";
const fixture = railSelectionFixture();
Object.assign(fixture.inputs[0].index.trains[0], { service_type: "新幹線", train_name: "テスト列車", destination_station: "B" });
const rail = selectRailJourney(fixture.candidate, fixture.inputs, fixture.selectedAt);
const trips = [createTrip("11111111-1111-4111-8111-111111111111", "乗換のある旅", fixture.selectedAt, [
  { id: "rail", title: "AからCへ", type: "transport", detail: { status: "selected", mode: "rail", journey: rail }, schedule: projectRailSchedule(rail) },
  { id: "visit", title: "町を歩く", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-09-13", timeZone: "Asia/Tokyo" } },
  { id: "stay", title: "町の宿", type: "stay", selection: { status: "unselected" }, schedule: { type: "day", date: "2026-09-13", endDate: "2026-09-14" } }
], { constraints: [], assumptions: [], party: { adults: 2, children: [{ age: 7 }], source: "user" } }),
createTrip("22222222-2222-4222-8222-222222222222", "別の旅", fixture.selectedAt)];
// A date selected after a logical itinerary must replace duplicate logical/calendar tabs.
trips[0] = { ...trips[0], schemaVersion: 3,
  timeline: { version: 1, logicalDays: [{ id: "d1", label: "1日目" }, { id: "d2", label: "2日目" }], calendarBindings: [] },
  items: trips[0].items.map(item => item.id === "visit" ? { ...item, schedule: { type: "relative", dayId: "d1" } } : item),
  request: { ...trips[0].request, constraints: [{ id: "dates", strength: "soft", source: "user", scope: { type: "trip" },
    requirement: { type: "dates", start: { earliest: "2026-09-13", latest: "2026-09-13" }, end: { earliest: "2026-09-14", latest: "2026-09-14" } } }] } };
const weatherItem = trips[0].items[0];
trips[0] = { ...trips[0], weather: [{ itemId: weatherItem.id, basis: tripWeatherBasis(trips[0], weatherItem), fetchedAt: fixture.selectedAt,
  validUntil: new Date(Date.parse(fixture.selectedAt) + 3_600_000).toISOString(), provider: "open-meteo", sourceUrl: "https://open-meteo.com/",
  forecasts: tripWeatherTargets(trips[0], weatherItem).map(target => ({ target, status: "available", locationName: target.place.name,
    timeZone: target.at.timeZone, rows: [{ date: target.startDate, hour: target.at.at.slice(11, 13) + ":00", weatherCode: 61, temperatureCelsius: 20, precipitationProbabilityPercent: 70 }] })) }] };
const guide = { id: trips[0].id, version: 1, publishedAt: new Date(trips[0].createdAt).toISOString(), trip: officialGuideSnapshot(trips[0]) };
const conversation = trip => ({ conversationId: trip.id, tripId: trip.id, title: trip.title, scope: "trip", summary: "", resolvedTopics: [], pendingTopics: [], createdAt: trip.createdAt, updatedAt: trip.updatedAt, revision: 0, messageCount: 2 });
await mkdir(".artifacts/product-design", { recursive: true });
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
const initialWeather = structuredClone(trips[0].weather);
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 360, height: 844 }, { width: 390, height: 844 }, { width: 768, height: 1000 }, { width: 1280, height: 900 }, { width: 1440, height: 900 }]) {
    trips[0] = { ...trips[0], revision: 0, weather: structuredClone(initialWeather), items: trips[0].items.map(({ bookingStatus: _booking, memo: _memo, ...item }) => item) };
    const weatherRefreshes = [];
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [], apiCalls = [], dataCalls = [], failures = [], consoleErrors = [];
    page.on("requestfailed", request => failures.push(new URL(request.url()).pathname));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", error => { errors.push(error.message); console.error("Synthetic Viewer page error", error.message); });
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) apiCalls.push(url.pathname);
      if (/viewer-input|\/api\/traffic/.test(url.pathname) || /(^|\.)mapbox\.com$/.test(url.hostname)) dataCalls.push(url.pathname);
    });
    await page.route("**/auth-config.json", route => route.fulfill({ json: config }));
    let providerLoggedIn = false, passiveAttempts = 0, restorationNonce;
    await page.route(`${config.loginOrigin}/oauth2/authorize?*`, route => {
      const request = new URL(route.request().url());
      assert.equal(request.searchParams.get("prompt"), "none");
      assert.equal(request.searchParams.get("code_challenge_method"), "S256");
      passiveAttempts++; restorationNonce = request.searchParams.get("nonce");
      const callback = new URL(config.callbackUrls[0]);
      callback.searchParams.set("state", request.searchParams.get("state"));
      callback.searchParams.set(providerLoggedIn ? "code" : "error", providerLoggedIn ? "fixture-code" : "login_required");
      return route.fulfill({ status: 302, headers: { location: callback.href } });
    });
    await page.route("**/api/**", route => {
      assert.equal(route.request().headers().authorization, "Bearer fixture-access");
      const path = new URL(route.request().url()).pathname;
      const command = route.request().postDataJSON();
      const trip = trips.find(t => t.id === command?.tripId || t.id === command?.conversationId);
      if (path === "/api/trips/v1" && command?.operation === "refresh-weather") {
        assert.equal(command.baseRevision, trip.revision);
        weatherRefreshes.push(command.itemId);
        const updated = { ...trip, revision: trip.revision + 1, weather: trip.weather.map(value => value.itemId === command.itemId ? { ...value, checkedAt: new Date().toISOString() } : value) };
        trips[trips.findIndex(value => value.id === trip.id)] = updated;
        return route.fulfill({ json: { version: "trip-api-v1", trip: updated, revision: updated.revision, mutationId: command.mutationId } });
      }
      if (path === "/api/trips/v1" && command?.operation === "mutate") {
        assert.equal(command.baseRevision, trip.revision);
        const updated = { ...applyTripProposal(trip, command.proposal), revision: trip.revision + 1 };
        trips[trips.findIndex(value => value.id === trip.id)] = updated;
        return route.fulfill({ json: { version: "trip-api-v1", trip: updated, revision: updated.revision, mutationId: command.mutationId } });
      }
      const json = path === "/api/profile/v1" ? { version: "profile-api-v1", profile: null }
        : path === "/api/trips/v1" ? { version: "trip-api-v1", ...(command?.operation === "get" ? { trip, role: "owner" } : { trips }) }
        : path === "/api/trips/sharing/v1" ? { version: "trip-sharing-v1", ...(command?.operation === "official-list" ? { guides: [guide] } : command?.operation === "official-get" ? { guide } : command?.operation === "official-capabilities" ? { publisher: false } : command?.operation === "manage" ? { participants: [], grants: [] } : { trips: [{ trip: trips[0], role: "owner" }] }) }
        : path === "/api/conversations/v1" ? { version: "conversation-api-v1", ...(command?.operation === "get" ? { conversation: conversation(trip ?? trips[0]) } : command?.operation === "history" ? { items: [{ role: "user", text: "乗換のある経路を比べてください", sequence: 1, createdAt: fixture.selectedAt }, { role: "assistant", sequence: 2, createdAt: fixture.selectedAt, ...consultationDesignFixture() }] } : { items: trips.map(conversation) }) }
        : { version: "conversation-api-v1", items: [] };
      return route.fulfill({ json });
    });
    async function ready() {
      try { await page.waitForSelector('#app[data-primary-view="chat"]'); }
      catch (error) {
        console.error("Synthetic startup diagnostics", { url: page.url(), errors, failures, consoleErrors,
          state: await page.evaluate(() => ({ primary: document.getElementById("app")?.dataset.primaryView,
            hidden: document.getElementById("app")?.hidden, status: document.getElementById("startup-status")?.textContent })) });
        throw error;
      }
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
    assert.equal(passiveAttempts, 1); // Guest reloads never loop through Cognito.

    // Top startup recovers a provider cookie without visiting Operations first.
    providerLoggedIn = true;
    await page.route(`${config.loginOrigin}/oauth2/token`, route => {
      assert.equal(new URLSearchParams(route.request().postData()).get("grant_type"), "authorization_code");
      const profile = { iss: config.issuer, aud: config.clientId, sub: "fixture-user", nonce: restorationNonce,
        email: "fixture@example.test", exp: Math.floor(Date.now() / 1000) + 300 };
      const idToken = `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify(profile)).toString("base64url")}.fixture`;
      return route.fulfill({ headers: { "access-control-allow-origin": origin }, json: { id_token: idToken,
        access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "Bearer", expires_in: 300, scope: config.scopes.join(" ") } });
    });
    await page.evaluate(clientId => sessionStorage.removeItem(`raiquora.auth.${clientId}.restore-attempt`), config.clientId);
    await page.goto(origin + "/"); await ready();
    await page.waitForSelector('#app[data-auth-state="signed-in"]');
    assert.equal(await page.locator('[data-primary="trips"]').isVisible(), true);
    assert.equal(passiveAttempts, 2);
    await page.reload(); await ready();
    assert.equal(passiveAttempts, 2);

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
    if (viewport.width <= 704) {
      const typography = await page.locator('#home-prompt').evaluate(el => ({font: getComputedStyle(el).fontSize, transform: getComputedStyle(el).transform}));
      assert.equal(typography.font, "16px");
      assert.match(typography.transform, /0\.875/);
    }
    if (viewport.width > 992) assert.equal(await page.locator(".product-nav").evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
    await page.locator("#home-prompt").fill("来週、出雲大社にいきたい");
    await page.locator("#home-prompt").focus();
    assert.equal(await page.locator("#home-prompt").evaluate(el => getComputedStyle(el).outlineStyle), "none");
    assert.equal(await page.locator(".home-prompt").evaluate(el => getComputedStyle(el).outlineWidth), "2px");
    await page.screenshot({ path: `.artifacts/product-design/home-${viewport.width}.png` });
    await page.locator("#home-prompt").fill("");
    await page.locator("[data-account]").click();
    await page.waitForSelector('[data-primary-view="my"]');
    assert.match(await page.locator("[data-my-account-status]").textContent(), /ログイン中/);
    await page.reload(); await page.waitForSelector('[data-primary-view="my"]');
    await page.waitForFunction(() => !document.getElementById("startup-status"));
    assert.equal(refreshes, 1);

    // Production DOM and existing server contracts, with synthetic owner-scoped data only.
    const checkLayout = async screen => {
      // All rendered features share restored authentication, including resumed tabs.
      const beforeResume = apiCalls.length;
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pageshow"));
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await page.locator("#app").getAttribute("data-auth-state"), "signed-in", screen);
      assert.equal(await page.locator("[data-my-login]").isVisible(), false, screen);
      assert.equal(await page.locator("[data-account]").getAttribute("aria-label"), "設定を開く", screen);
      assert.match(await page.locator("[data-my-account-status]").textContent(), /ログイン中/, screen);
      assert.equal(await page.locator('[data-primary="trips"]').isVisible(), true, screen);
      assert.equal(apiCalls.length, beforeResume, `resume must not repeat business requests: ${screen}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${screen} overflow at ${viewport.width}`);
      assert.equal(await page.locator("#app").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(250, 250, 250)");
      await page.screenshot({ path: `.artifacts/product-design/${screen}-${viewport.width}.png` });
    };
    await checkLayout("settings");
    await page.locator(".settings-section").filter({ has: page.locator("#travel-profile-page") }).locator("summary").first().click();
    await checkLayout("preferences");
    await page.locator('[data-primary="trips"]').click();
    await page.locator("[data-trip]").first().waitFor(); assert.equal(await page.locator("[data-trip]").count(), 2);
    await checkLayout("trip-list");
    await page.getByRole("tab", { name: "共有中の旅", exact: true }).click();
    await page.locator('[data-page="trips"] .trip-library-card').waitFor(); await checkLayout("shared-trips");
    assert.equal(await page.getByRole("tab", { name: "公式しおり", exact: true }).count(), 0);
    await page.locator('[data-primary="chat"]').click();
    await page.locator('[data-home-official-guides]').waitFor();
    await page.getByRole("button", { name: "しおりを見る", exact: true }).waitFor(); await checkLayout("official-guides");
    await page.getByRole("button", { name: "しおりを見る", exact: true }).click();
    await page.locator(".trip-sharing-panel[open]").waitFor(); await checkLayout("official-import");
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.locator('[data-primary="trips"]').click();
    await page.getByRole("tab", { name: "あなたの旅", exact: true }).click();
    assert.equal(await page.locator('.trip-timeline-content .trip-workspace-item-icon').count(), 0);

    await page.locator(`[data-trip="${trips[0].id}"]`).click();
    await page.waitForLoadState("networkidle");
    await page.locator('.trip-workspace .trip-workspace-card[data-item-id="rail"]').waitFor().catch(async error => {
      console.error("Synthetic timeline diagnostics", { errors, consoleErrors, cards: await page.locator(".trip-workspace-card").count(), title: await page.locator(".trip-workspace-heading").textContent() });
      await page.screenshot({ path: `.artifacts/product-design/timeline-failure-${viewport.width}.png` }); throw error;
    });
    await page.waitForFunction(() => document.querySelectorAll(".trip-route-leg").length === 2);
    assert.equal(await page.locator('.trip-timeline-content .trip-workspace-item-icon').count(), 0);
    assert.ok(await page.locator('.trip-timeline-rail .trip-workspace-item-icon').count() > 0);

    console.log("Timeline render diagnostics", { errors, consoleErrors });
    assert.deepEqual(errors, []);
    assert.equal(await page.locator(".trip-detail-tabs").count(), 0);
    assert.equal(await page.locator(".trip-workspace-readiness, .trip-workspace-checklist, .trip-workspace-feasibility").count(), 0);
    assert.deepEqual(await page.locator('.trip-day-tabs [role="tab"]').allTextContents(), ["9月13日(日)", "9月14日(月)"]);
    assert.deepEqual(await page.locator('.trip-workspace-day:not([hidden]) [data-item-id]').evaluateAll(cards => cards.map(card => card.dataset.itemId)), ["rail", "visit", "stay"]);
    assert.match(await page.locator('.trip-workspace-day:not([hidden]) [data-item-id="stay"]').textContent(), /未定.*チェックイン/s);
    await page.getByRole("tab", { name: "2026-09-14", exact: true }).click();
    assert.match(await page.locator('.trip-workspace-day:not([hidden]) [data-item-id="stay"]').textContent(), /未定.*チェックアウト/s);
    await checkLayout("checkout");
    await page.getByRole("tab", { name: "2026-09-13", exact: true }).click();
    assert.match(await page.locator(".trip-route-service").first().textContent(), /新幹線 テスト列車/);
    await checkLayout("timeline");
    assert.equal(await page.locator(".trip-route-leg").count(), 2);
    assert.match(await page.locator(".trip-route-transfer").textContent(), /乗換10分/);
    assert.match(await page.locator(".trip-itinerary-dates").textContent(), /9月13日ー9月14日・1泊2日/);
    assert.deepEqual(await page.locator(".trip-day-tabs [role=tab]").allTextContents(), ["9月13日(日)", "9月14日(月)"]);
    await checkLayout("timeline");
    const weatherCard = page.locator('.trip-workspace-day:not([hidden]) [data-item-id="rail"]');
    if (await weatherCard.locator('.trip-item-toggle').getAttribute('aria-expanded') === 'false') await weatherCard.locator('.trip-item-toggle').click();
    assert.equal(await weatherCard.locator('.trip-item-weather p').count(), 2);
    assert.match(await weatherCard.locator('.trip-item-weather').textContent(), /出発.*雨.*到着.*雨/s);
    assert.equal(await weatherCard.getByRole("button", { name: "天気を更新", exact: true }).count(), 0);
    assert.deepEqual(weatherRefreshes, ["rail"]);
    await weatherCard.locator(".trip-item-booking .trip-field-pencil").click();
    assert.ok(await weatherCard.locator(".trip-item-booking select").evaluate(el => el.getBoundingClientRect().height) <= 34);
    await weatherCard.locator(".trip-item-booking select").selectOption("booked");
    await page.waitForFunction(() => document.querySelector('[data-item-id="rail"] .trip-item-booking select')?.value === "booked" && !document.querySelector('[data-item-id="rail"] .trip-item-booking select')?.disabled);
    assert.equal(trips[0].items[0].bookingStatus, "booked");
    const memoDisclosure = weatherCard.locator(".trip-item-memo-disclosure");
    assert.equal(await memoDisclosure.getAttribute("open"), null);
    await memoDisclosure.locator("summary").click();
    const memoField = weatherCard.locator(".trip-item-memo textarea");
    assert.equal(await weatherCard.locator(".trip-item-memo button").count(), 0);
    await memoField.fill("ブラウザからの自動保存メモ");
    await weatherCard.locator(".trip-item-booking .trip-field-pencil").focus();
    await page.waitForFunction(() => document.querySelector('[data-item-id="rail"] .trip-item-memo textarea')?.value === "ブラウザからの自動保存メモ" && !document.querySelector('[data-item-id="rail"] .trip-item-memo textarea')?.readOnly);
    assert.equal(trips[0].items[0].memo, "ブラウザからの自動保存メモ");
    await memoField.fill("自動保存メモを再編集");
    await memoDisclosure.locator("summary").click();
    await page.waitForFunction(() => document.querySelector('[data-item-id="rail"] .trip-item-memo textarea')?.value === "自動保存メモを再編集" && !document.querySelector('[data-item-id="rail"] .trip-item-memo textarea')?.readOnly);
    assert.equal(trips[0].items[0].memo, "自動保存メモを再編集");
    assert.equal(await memoDisclosure.getAttribute("open"), null);
    await memoDisclosure.locator("summary").click();
    assert.equal(await memoField.inputValue(), "自動保存メモを再編集");
    const noticeMetrics = await page.locator(".app-save-notification").evaluate(notice => {
      const box = notice.getBoundingClientRect(), text = notice.querySelector("span").getBoundingClientRect(), ring = notice.querySelector(".app-save-countdown").getBoundingClientRect();
      return { width: box.width, height: box.height, background: getComputedStyle(notice).backgroundColor,
        alignment: Math.abs((text.top + text.bottom) / 2 - (ring.top + ring.bottom) / 2) };
    });
    assert.ok(noticeMetrics.width >= Math.min(560, viewport.width - 32) - 1);
    assert.ok(noticeMetrics.height <= 42, `Notice too tall: ${noticeMetrics.height}px`);
    assert.ok(noticeMetrics.background.startsWith("rgba("), "Notice should be translucent");
    assert.ok(noticeMetrics.alignment <= 1, `Notice countdown alignment: ${noticeMetrics.alignment}px`);
    assert.equal(await page.locator(".app-save-notification button").count(), 0);
    const ringProgress = page.locator(".app-save-countdown-progress");
    const initialOffset = await ringProgress.evaluate(circle => Number(circle.style.strokeDashoffset));
    await page.waitForFunction(offset => Number(document.querySelector(".app-save-countdown-progress")?.style.strokeDashoffset) < offset, initialOffset);
    const heroBalance = await page.locator(".trip-header-content").evaluate(content => {
      const box = content.getBoundingClientRect(), nodes = [...content.children].map(node => node.getBoundingClientRect());
      return Math.abs((Math.min(...nodes.map(node => node.top)) - box.top) - (box.bottom - Math.max(...nodes.map(node => node.bottom))));
    });
    assert.ok(heroBalance <= 3, `Header vertical padding differs by ${heroBalance}px`);
    const pencilSizes = await page.locator(".trip-workspace .trip-pencil:not([hidden]) svg").evaluateAll(icons => icons.map(icon => {
      const box = icon.getBoundingClientRect(); return { width: box.width, height: box.height };
    }).filter(box => box.width > 0));
    assert.ok(pencilSizes.length > 0);
    assert.ok(pencilSizes.every(box => Math.abs(box.width - 16) < .1 && Math.abs(box.height - 16) < .1), `Pencil sizes differ: ${JSON.stringify(pencilSizes)}`);
    await checkLayout("trip-metadata-save");
    await weatherCard.locator('.trip-item-toggle').click();
    await page.locator(".trip-header-management > summary").click();
    await page.locator(".trip-header-menu").getByRole("button", { name: "共有", exact: true }).click();
    await page.locator(".trip-sharing-panel[open]").waitFor();
    const sharing = page.locator(".trip-sharing-panel[open]");
    assert.equal(await sharing.getByText("共有リンクで参加", { exact: true }).isVisible(), false);
    assert.equal(await sharing.getByLabel("有効期限", { exact: true }).getAttribute("required"), "");
    assert.equal(await sharing.getByText("期限を指定", { exact: true }).isVisible(), true);
    assert.equal(await sharing.getByLabel("作成した共有リンク", { exact: true }).isVisible(), true);
    assert.equal(await sharing.getByRole("button", { name: "コピー", exact: true }).isDisabled(), true);
    await checkLayout("trip-sharing");
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: `.artifacts/product-design/timeline-dark-${viewport.width}.png` });
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await page.getByRole("button", { name: "＋ この後に追加", exact: true }).count(), 0);
    const addition = page.locator('.trip-workspace-day:not([hidden]) .trip-timeline-add[data-after-id="visit"]');
    await addition.click();
    assert.equal(await page.locator('.trip-workspace-add select').count(), 0);
    await page.locator('.trip-workspace-add').getByLabel("どんな予定を追加したい？").fill("駅前で地元のものを食べたい");
    assert.equal(await page.locator('.trip-workspace-add input').count(), 0);
    assert.equal(await page.locator(".trip-workspace-add").isVisible(), true);
    await checkLayout("spot-add");
    await page.locator('.trip-workspace-add button').filter({ hasText: "取消" }).click();
    await page.getByRole("button", { name: "町を歩くの時刻を登録", exact: true }).click();
    const timeEditor = page.getByRole("dialog", { name: "予定の時刻", exact: true });
    assert.equal(await timeEditor.locator(".trip-time-editor").isVisible(), true);
    await checkLayout("time-editor");
    await timeEditor.getByLabel("日付", { exact: true }).fill("2026-09-13");
    await timeEditor.getByLabel("時刻", { exact: true }).fill("15:30");
    await timeEditor.getByRole("button", { name: "確定", exact: true }).click();
    await timeEditor.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector('[data-item-id="visit"] .trip-time-control')?.textContent.includes("15:30"));
    assert.equal(await page.getByText("変更内容を確認", { exact: true }).count(), 0);
    assert.equal(trips[0].items.find(item => item.id === "visit").schedule.startAt.at, "2026-09-13T15:30:00+09:00");
    await page.getByRole("button", { name: "人数を変更", exact: true }).click();
    assert.equal(await page.locator(".trip-party-editor").isVisible(), true); await checkLayout("party-editor");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('.trip-editor-dialog[open]'));
    await page.getByRole("button", { name: "‹ 旅程一覧", exact: true }).click();
    await page.locator(`[data-trip="${trips[1].id}"]`).click();
    await page.waitForFunction(() => document.querySelector(".trip-workspace-heading h1")?.textContent === "別の旅");
    assert.equal(await page.locator(".trip-workspace-card").count(), 0);
    await page.getByRole("button", { name: "‹ 旅程一覧", exact: true }).click();
    await page.locator(`[data-trip="${trips[0].id}"]`).click();
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator(".trip-header-management").count(), 1);
    assert.deepEqual(await page.locator(".trip-header-actions button").allTextContents(), ["旅程を確定", "相談"]);
    assert.equal(await page.locator(".trip-item-consult").count(), 0);
    await page.locator(".trip-header-actions").getByRole("button", { name: "相談", exact: true }).click();
    const consultation = page.getByRole("dialog", { name: "どれについて相談しますか？", exact: true });
    await consultation.waitFor();
    assert.ok(await consultation.locator(".trip-consultation-options button").count() <= 3);
    assert.equal(await consultation.getByRole("button", { name: "相談する", exact: true }).isDisabled(), true);
    const exampleStyle = await consultation.locator(".trip-consultation-options button").first().evaluate(button => ({
      size: parseFloat(getComputedStyle(button).fontSize), background: getComputedStyle(button).backgroundColor,
    }));
    assert.ok(exampleStyle.size <= 13);
    assert.equal(exampleStyle.background, "rgba(0, 0, 0, 0)");
    const freeInput = consultation.getByLabel("ほかのことを相談", { exact: true });
    await freeInput.fill("前後の予定に余裕がありますか？");
    assert.equal(await consultation.getByRole("button", { name: "相談する", exact: true }).isDisabled(), false);
    const spacing = await consultation.evaluate(dialog => {
      const examples = dialog.querySelector(".trip-consultation-options").getBoundingClientRect();
      const form = dialog.querySelector(".trip-consultation-form").getBoundingClientRect();
      const input = dialog.querySelector("textarea").getBoundingClientRect();
      const actions = dialog.querySelector(".trip-consultation-actions").getBoundingClientRect();
      return { formGap: form.top - examples.bottom, actionsGap: actions.top - input.bottom };
    });
    assert.ok(spacing.formGap >= 20 && spacing.actionsGap >= 16, `Consultation spacing: ${JSON.stringify(spacing)}`);
    await checkLayout("consultation-topics");
    await consultation.getByRole("button", { name: /経路を選び直す/ }).first().click();
    await page.locator(".consultation-messages .journey-presentation").waitFor();
    assert.equal(await page.locator(".consultation-page .public-plan-presentation").count(), 0);
    assert.equal(await page.locator(".consultation-page .journey-presentation").count(), 1);
    assert.equal(await page.locator(".ai-guide-message-copy").first().textContent(), "経路3件を表示しました。パネルで比較できます。");
    const supplement = page.locator(".candidate-reply-details").first();
    assert.equal(await supplement.evaluate(el => el.open), false);
    assert.equal(await supplement.locator("strong").first().isVisible(), false);
    await supplement.locator("summary").click();
    assert.match(await supplement.locator("strong").first().textContent(), /経路1/);
    assert.equal(await supplement.locator("strong").first().isVisible(), true);
    await supplement.locator("summary").click();
    assert.equal(await page.locator(".ai-guide-message-copy p").first().evaluate(el => getComputedStyle(el).fontSize), "14px");
    await checkLayout("chat");
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal(await page.locator(".consultation-page").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(250, 250, 250)");
    await page.screenshot({ path: `.artifacts/product-design/chat-dark-${viewport.width}.png` });
    await page.emulateMedia({ colorScheme: "light" });
    await page.locator('[data-account]').click();
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal(await page.locator("#app").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(250, 250, 250)");
    await page.screenshot({ path: `.artifacts/product-design/settings-dark-${viewport.width}.png` });
    await page.emulateMedia({ colorScheme: "light" });

    // CI bundles a dummy Mapbox token; force a deterministic adapter load failure.
    await page.route("**/mapbox-*.js", route => route.abort());
    await page.locator('[data-map-navigation]').click();
    await page.waitForSelector('#app[data-primary-view="map"]');
    await page.getByText('地図を起動できませんでした。もう一度開くと再試行できます。相談は引き続き利用できます。').first().waitFor();
    if (viewport.width > 992) assert.equal(await page.locator("#map").evaluate(el => getComputedStyle(el).top), "0px");
    await checkLayout("operation-unavailable");
    await page.unroute("**/mapbox-*.js");
    await page.locator('[data-account]').click();

    // Resume a suspended tab after its absolute deadline: no refresh or protected data.
    providerLoggedIn = false;
    const beforeExpiry = apiCalls.length;
    await page.clock.setSystemTime(new Date(issuedAt + 12 * 60 * 60 * 1000));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow"))); await ready();
    assert.equal(refreshes, 1); assert.equal(apiCalls.length, beforeExpiry);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
    await page.reload(); await ready();
    assert.equal(await page.locator("#app").getAttribute("data-auth-state"), "signed-out");
    assert.equal(passiveAttempts, 3);
    assert.deepEqual(dataCalls, []); assert.deepEqual(errors, []);

    // Explicit logout clears tab credentials before Cognito navigation, then Home still mounts.
    providerLoggedIn = true; // Even a leftover provider cookie must not undo explicit logout.
    const logoutTime = issuedAt + 12 * 60 * 60 * 1000;
    await page.evaluate(({ key, config, logoutTime }) => sessionStorage.setItem(key, JSON.stringify({ version: 1,
      issuer: config.issuer, clientId: config.clientId, scopes: config.scopes, accessToken: "fixture-access",
      refreshToken: "fixture-refresh", issuedAt: logoutTime, expiresAt: logoutTime + 300_000,
      absoluteExpiresAt: logoutTime + 12 * 60 * 60 * 1000, displayName: "fixture user" })), { key, config, logoutTime });
    await page.route(`${config.loginOrigin}/oauth2/revoke`, route => route.fulfill({ body: "", status: 200, headers: { "access-control-allow-origin": origin } }));
    await page.route(`${config.loginOrigin}/logout?*`, route => route.fulfill({ status: 302, headers: { location: origin + "/" } }));
    await page.reload(); await ready();
    await page.locator("[data-account]").click(); await page.waitForSelector('[data-primary-view="my"]');
    await page.locator(".settings-section").filter({ has: page.locator("[data-my-logout]") }).locator("summary").first().click();
    await Promise.all([page.waitForEvent("load"), page.locator("[data-my-logout]").click()]); await ready();
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
    assert.equal(passiveAttempts, 3);
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
} catch (error) { console.error(error); throw error; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
