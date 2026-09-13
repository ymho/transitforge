import { describe, expect, it, vi } from "vitest";
import { JmaHazardAlertProvider, parseJmaAtomFeed } from "./jma-hazard-alert-provider.js";
import { validateHazardAlertInformation } from "@raiquora/trip/hazard-alert";

const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>気象特別警報・警報・注意報</title><id>https://www.data.jma.go.jp/developer/xml/data/osaka.xml</id><updated>2026-08-30T07:44:43Z</updated><author><name>大阪管区気象台</name></author><link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/osaka.xml"/><content type="text">【大阪府気象警報・注意報】大阪府では、土砂災害や落雷に注意してください。</content></entry>
<entry><title>震源・震度に関する情報</title><id>https://www.data.jma.go.jp/developer/xml/data/quake.xml</id><updated>2026-08-30T07:40:00Z</updated><author><name>気象庁</name></author><link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/quake.xml"/><content type="text">島根県東部で震度3を観測しました。</content></entry>
</feed>`;

describe("JmaHazardAlertProvider", () => {
  it("Atomフィードを地域で絞り公式Evidenceを返す", async () => {
    const fetch = vi.fn(async () => new Response(feed, { status: 200, headers: { "content-type": "application/xml" } }));
    const provider = new JmaHazardAlertProvider({ fetch }, () => new Date("2026-08-30T08:00:00.000Z"));
    const result = await provider.search({ area: "大阪府" });
    expect(result.status).toBe("available");
    expect(result.data?.alerts).toHaveLength(1);
    expect(result.data?.alerts[0]).toMatchObject({ category: "warning", severity: "warning", issuer: "大阪管区気象台" });
    expect(result.evidence).toHaveLength(2);
    expect(result.data?.area).toBe("大阪府");
    expect(() => validateHazardAlertInformation(result)).not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    await provider.search({ area: "大阪" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("地域に情報がない場合も取得成功と空配列を区別する", async () => {
    const provider = new JmaHazardAlertProvider({ fetch: async () => new Response(feed) });
    const result = await provider.search({ area: "沖縄県" });
    expect(result.status).toBe("available");
    expect(result.data?.alerts).toEqual([]);
    expect(result.data?.area).toBe("沖縄県");
  });

  it("カテゴリとlimitを適用し、キャッシュでも取得日時を偽装しない", async () => {
    let now = new Date("2026-08-30T08:00:00Z");
    const fetch = vi.fn(async () => new Response(feed));
    const provider = new JmaHazardAlertProvider({ fetch }, () => now);
    const first = await provider.search({ area: "島根県", categories: ["earthquake"], limit: 1 });
    expect(first.data?.alerts.map((a) => a.category)).toEqual(["earthquake"]);
    now = new Date("2026-08-30T08:00:30Z");
    const cached = await provider.search({ area: "島根県" });
    expect(cached.evidence).toEqual(first.evidence);
    expect(cached.freshness).toBe("fresh");
    expect(fetch).toHaveBeenCalledTimes(2);
    now = new Date("2026-08-30T08:02:00Z");
    await provider.search({ area: "島根県" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each(["<html>error</html>", "not XML", "<feed><entry></feed>", "<feed><error>broken</feed>", feed.replace("2026-08-30T07:44:43Z", "yesterday"),
    feed.replace("<content type=\"text\">", "<missing>"),
    feed.replace("href=\"https://www.data.jma.go.jp/developer/xml/data/osaka.xml\"", "href=\"https://user:secret@example.com/?token=secret\""),
  ])("不正フィードを空の正常情報として扱わない", async (xml) => {
    const provider = new JmaHazardAlertProvider({ fetch: async () => new Response(xml) });
    const result = await provider.search({ area: "大阪府" });
    expect(result).toMatchObject({ status: "unavailable", freshness: "unknown", failure: { code: "invalid_response" } });
    expect(result.data).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("HTTP失敗・一部feed失敗を安全扱いせず、無効なqueryを送信しない", async () => {
    const fetch = vi.fn(async (url: string) => url.includes("eqvol") ? new Response("failure", { status: 503 }) : new Response(feed));
    const provider = new JmaHazardAlertProvider({ fetch });
    const result = await provider.search({ area: "大阪府" });
    expect(result).toMatchObject({ status: "unavailable", failure: { code: "unavailable" } });
    expect(result.data).toBeUndefined();
    fetch.mockClear();
    expect((await provider.search({ area: "大阪府", limit: NaN })).status).toBe("unknown");
    expect(fetch).not.toHaveBeenCalled();
    const rejected = new JmaHazardAlertProvider({ fetch: async () => { throw new Error("timeout"); } });
    expect((await rejected.search({ area: "大阪府" })).status).toBe("unavailable");
  });
});

describe("parseJmaAtomFeed", () => {
  it("地震カテゴリとXML文字参照を復元する", () => {
    const alerts = parseJmaAtomFeed(feed.replace("震度3", "震度3 &amp; 津波なし"));
    expect(alerts[1]).toMatchObject({ category: "earthquake", summary: expect.stringContaining("& 津波なし") });
  });
  it.each([
    ["気象警報", "特別警報", "warning", "emergency"], ["台風情報", "厳重に警戒", "typhoon", "warning"],
    ["震源情報", "情報", "earthquake", "information"], ["津波警報", "大津波警報", "tsunami", "emergency"],
    ["火山情報", "噴火警報 居住地域", "volcano", "emergency"], ["気象解説", "注意報", "weather-information", "advisory"],
    ["試験発表", "未分類", "other", "unknown"],
  ])("%sの能力を維持する", (title, summary, category, severity) => {
    const xml = `<feed><entry><title>${title}</title><id>opaque:Ａ</id><updated>2026-08-30T07:00:00Z</updated><link href="https://www.data.jma.go.jp/developer/xml/data/test.xml"/><content>${summary}</content><raw>PRIVATE-RAW</raw></entry></feed>`;
    const [alert] = parseJmaAtomFeed(xml);
    expect(alert).toMatchObject({ providerAlertId: "opaque:Ａ", category, severity });
    expect(Object.keys(alert!)).toEqual(["providerAlertId", "category", "severity", "title", "summary", "issuedAt", "sourceUrl"]);
    expect(JSON.stringify(alert)).not.toContain("PRIVATE-RAW");
  });
  it("表示本文だけをboundedにし、IDやURLを切って別identityにしない", () => {
    const longSummary = feed.replace("【大阪府気象警報・注意報】", "あ".repeat(800));
    expect(parseJmaAtomFeed(longSummary)[0]!.summary.length).toBe(600);
    expect(() => parseJmaAtomFeed(feed.replace(/<id>[^<]+<\/id>/u, `<id>${"x".repeat(301)}</id>`))).toThrow();
  });
});
