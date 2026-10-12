import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const output = resolve(process.argv[2] ?? ".artifacts/unified-consultation");
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5178";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Only local synthetic previews are permitted");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const captures = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const errors = [], unexpected = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/__consultation_preview") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>相談UI検証</title></head><body><script type="module" src="/src/dev/unified-consultation-preview.ts"></script></body></html>' });
      if (url.origin !== new URL(base).origin) { unexpected.push(url.origin); return route.abort(); }
      if (url.pathname.startsWith("/api/")) { unexpected.push(url.pathname); return route.abort(); }
      return route.continue();
    });
    for (let attempt = 0; ; attempt++) {
      try { const response = await page.request.get(`${base}/src/dev/unified-consultation-preview.ts`); if (response.ok()) break; throw new Error("Vite not ready"); }
      catch (error) { if (attempt >= 30) throw error; await new Promise(done => setTimeout(done, 500)); }
    }
    await page.goto(`${base}/__consultation_preview#chat`);
    await page.locator('body[data-consultation-preview="ready"]').waitFor();
    const capture = async screen => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${screen}/${width}: horizontal overflow`);
      assert.deepEqual(errors, [], `${screen}/${width}: browser errors`);
      await page.screenshot({ path: `${output}/${screen}-${width}.png` }); captures.push({ screen, width });
    };
    assert.deepEqual(await page.locator(".product-nav a, .product-nav button").allTextContents(), ["ホーム", "旅程", "運行", "設定"]);
    assert.equal(await page.locator('[data-page="explore"]').count(), 0);
    assert.equal(await page.locator(".home-hero").isVisible(), true);
    assert.equal(await page.locator(".consultation-page").isVisible(), false);
    await page.waitForFunction(() => [...document.querySelectorAll("[data-hero-image]")].some(image => !image.hidden && image.complete && image.naturalWidth > 0));
    await capture("new-hero");
    await page.locator("[data-home-theme]").first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll(".home-theme-media img")].every(image => image.complete && image.naturalWidth > 0));
    await capture("home-content");
    await page.locator("[data-home-theme]").first().click();
    assert.match(await page.locator("#home-prompt").inputValue(), /瀬戸内/);
    assert.equal(await page.locator("body").getAttribute("data-submissions"), null);
    await page.locator("#home-prompt").fill("出雲大社に行きたい");
    await page.locator(".home-prompt button").click();
    await page.locator('#app[data-consultation-mode="conversation"]').waitFor();
    assert.equal(await page.locator(".home-hero").isVisible(), false);
    assert.equal(await page.locator(".consultation-page").isVisible(), true);
    assert.equal(await page.locator("body").getAttribute("data-submissions"), "1");
    assert.match(await page.locator("#ai-guide-messages").innerText(), /出雲大社に行きたい/);
    const composer = await page.locator(".consultation-composer").boundingBox(), nav = await page.locator(".product-nav").boundingBox();
    assert.ok(composer && nav && (width > 1000 || composer.y + composer.height <= nav.y + 2), `composer must not overlap menu at ${width}`);
    await capture("new-conversation");
    await page.locator('[data-primary="trips"]').click();
    await page.locator('[data-page="trips"] [data-trip]').click();
    assert.equal(await page.locator(".trip-workspace").isVisible(), true);
    assert.equal(await page.locator(".consultation-page").isVisible(), false);
    await capture("trip");
    await page.locator(".trip-workspace-navigation").getByRole("tab", { name: "チャット", exact: true }).click();
    await page.locator(".consultation-composer input").fill("まだ送らない相談");
    await page.locator(".trip-workspace-navigation").getByRole("tab", { name: "旅程", exact: true }).click();
    await page.locator(".trip-workspace-navigation").getByRole("tab", { name: "チャット", exact: true }).click();
    assert.equal(await page.locator(".consultation-composer input").inputValue(), "まだ送らない相談");
    await page.locator(".trip-workspace-navigation").getByRole("tab", { name: "旅程", exact: true }).click();
    await page.locator(".trip-header-actions").getByRole("button", { name: "相談", exact: true }).click();
    const consultation = page.getByRole("dialog", { name: "どれについて相談しますか？" });
    await consultation.getByLabel("ほかのことを相談", { exact: true }).fill("次に決めることを相談したい");
    await consultation.getByRole("button", { name: "相談する", exact: true }).click();
    assert.equal(await page.locator(".home-hero").isVisible(), false);
    assert.equal(await page.locator(".consultation-page").isVisible(), true);
    assert.match(await page.locator(".trip-header-title-row").innerText(), /出雲旅行/);
    assert.equal(await page.evaluate(() => history.state.tripId), "74200000-0000-4000-8000-000000000001");
    const chatBox = await page.locator(".consultation-page").boundingBox(), tripTabs = await page.locator(".trip-workspace-navigation").boundingBox();
    assert.ok(chatBox && tripTabs && chatBox.y >= tripTabs.y + tripTabs.height - 1 && chatBox.height >= 350, `chat must fit below tabs at ${width}`);
    const tripComposer = await page.locator(".consultation-composer").boundingBox();
    assert.ok(tripComposer && nav && (width > 1000 || tripComposer.y + tripComposer.height <= nav.y + 2), `trip composer must not overlap menu at ${width}`);
    await capture("trip-conversation");
    await page.locator(".trip-workspace-navigation").getByRole("tab", { name: "旅程", exact: true }).click();
    assert.equal(await page.locator(".trip-workspace").isVisible(), true);
    await page.locator('[data-primary="chat"]').click();
    assert.equal(await page.locator(".home-hero").isVisible(), true);
    assert.equal(await page.locator(".consultation-page").isVisible(), false);
    assert.equal(await page.evaluate(() => history.state.tripId), undefined);
    await capture("fresh-again");
    await writeFile(`${output}/requests-${width}.json`, JSON.stringify({ externalRequestsBlocked: [...new Set(unexpected)], pageErrors: errors }, null, 2));
    await page.close();
  }
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, browser: browser.version(), captures,
    scope: "actual production view components and CSS with synthetic in-memory state; no API/Bedrock/user session", visualReview: "screenshots recorded" }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: captures.length, widths: [1440, 390] }));
} finally { await browser.close(); }
