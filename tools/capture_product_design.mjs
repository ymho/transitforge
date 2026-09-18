import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// Verification only. Both pages use the same browser/viewport; no production data is loaded.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const output = resolve(process.argv[2] ?? "/tmp/raiquora-product-design");
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5178";
const reference = pathToFileURL(resolve("tests/fixtures/ui/transitforge_ai_first_mock_v6.html")).href;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const captures = [];
try {
  for (const width of [1440, 390]) {
    const options = { viewport: { width, height: 1000 }, reducedMotion: "reduce" };
    const ref = await browser.newPage(options), app = await browser.newPage(options);
    // The reference's hidden offscreen sheet must not be included through fullPage screenshots.
    await ref.goto(reference);
    for (let attempt = 0; ; attempt++) {
      try { await app.goto(`${base}/?home-preview=data`); break; }
      catch (error) { if (attempt >= 20) throw error; await new Promise((r) => setTimeout(r, 500)); }
    }
    await app.locator(".preview-notice").waitFor();
    assert.equal(await app.locator(".home-candidate").count(), 3, "data preview must match reference card density");
    const capture = async (screen) => {
      for (const [label, page] of [["v6", ref], ["implementation", app]]) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} horizontal overflow`);
        await page.screenshot({ path: `${output}/${screen}-${width}-${label}.png` });
      }
      captures.push({ screen, width, height: 1000 });
    };
    await capture("home");
    await ref.locator(".next-trip").scrollIntoViewIfNeeded();
    await app.locator(".home-next").scrollIntoViewIfNeeded();
    await capture("home-cards");
    await ref.locator('[data-view="profile"]:visible').first().click();
    await app.locator('[data-primary="my"]').click();
    // Seed comparable preferences through real UI, not a second storage contract.
    await app.locator("[data-profile]").click();
    await app.locator('[name="mode"]').selectOption("rail");
    await app.locator('[data-choice="pace"][data-value="0.2"]').click();
    await app.locator('[data-choice="interest-food"]').click();
    await app.locator('[type="submit"][form="travel-profile-form"]').click();
    await app.locator("#travel-profile-page [data-close]").first().click();
    await capture("my");
    await ref.locator("#openProfileEditor").click();
    await app.locator("[data-profile]").click();
    await capture("profile");
    await ref.close(); await app.close();
  }
  const rows = captures.map(({ screen, width }) => `<h2>${screen} / ${width}px</h2><div class="pair"><figure><figcaption>v6</figcaption><img src="${screen}-${width}-v6.png"></figure><figure><figcaption>実装・開発preview</figcaption><img src="${screen}-${width}-implementation.png"></figure></div>`).join("\n");
  await writeFile(`${output}/index.html`, `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Wave 1 UI比較</title><style>body{font-family:system-ui;background:#eee;margin:24px}.pair{display:flex;align-items:start;gap:16px}figure{margin:0;flex:1;min-width:0}img{width:100%;height:auto}figcaption{padding:12px;background:white}</style><h1>同じChromium・1440/390 × 1000</h1><p>左: 利用者提供v6。右: 本番共通UIに開発サンプルを注入。固定データは本番の確認済み情報ではない。機能の合否と視覚レビューは別。</p>${rows}</html>`);
  const comparison = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await comparison.goto(pathToFileURL(`${output}/index.html`).href);
  const pairs = comparison.locator(".pair");
  for (let i = 0; i < captures.length; i++) {
    await pairs.nth(i).screenshot({ path: `${output}/${captures[i].screen}-${captures[i].width}-comparison.png` });
  }
  await writeFile(`${output}/verification.json`, JSON.stringify({ captures, browser: browser.version(), state: "development-preview", automatedChecks: ["no-horizontal-overflow", "three-candidate-data-state"], visualApproval: "manual-review-required" }, null, 2));
  console.log(`Visual comparison: ${output}/index.html`);
} finally { await browser.close(); }
