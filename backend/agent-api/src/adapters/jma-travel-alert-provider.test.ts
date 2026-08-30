import { describe, expect, it, vi } from "vitest";
import { JmaTravelAlertProvider, parseJmaAtomFeed } from "./jma-travel-alert-provider.js";

const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>気象特別警報・警報・注意報</title><id>https://www.data.jma.go.jp/developer/xml/data/osaka.xml</id><updated>2026-08-30T07:44:43Z</updated><author><name>大阪管区気象台</name></author><link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/osaka.xml"/><content type="text">【大阪府気象警報・注意報】大阪府では、土砂災害や落雷に注意してください。</content></entry>
<entry><title>震源・震度に関する情報</title><id>https://www.data.jma.go.jp/developer/xml/data/quake.xml</id><updated>2026-08-30T07:40:00Z</updated><author><name>気象庁</name></author><link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/quake.xml"/><content type="text">島根県東部で震度3を観測しました。</content></entry>
</feed>`;

describe("JmaTravelAlertProvider", () => {
  it("Atomフィードを地域で絞り公式Evidenceを返す", async () => {
    const fetch = vi.fn(async () => new Response(feed, { status: 200, headers: { "content-type": "application/xml" } }));
    const provider = new JmaTravelAlertProvider({ fetch }, () => new Date("2026-08-30T08:00:00.000Z"));
    const result = await provider.search({ area: "大阪府" });
    expect(result.status).toBe("available");
    expect(result.data?.alerts).toHaveLength(1);
    expect(result.data?.alerts[0]).toMatchObject({ category: "warning", severity: "warning", issuer: "大阪管区気象台" });
    expect(result.evidence).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    await provider.search({ area: "大阪" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("地域に情報がない場合も取得成功と空配列を区別する", async () => {
    const provider = new JmaTravelAlertProvider({ fetch: async () => new Response(feed) });
    const result = await provider.search({ area: "沖縄県" });
    expect(result.status).toBe("available");
    expect(result.data?.alerts).toEqual([]);
  });
});

describe("parseJmaAtomFeed", () => {
  it("地震カテゴリとXML文字参照を復元する", () => {
    const alerts = parseJmaAtomFeed(feed.replace("震度3", "震度3 &amp; 津波なし"));
    expect(alerts[1]).toMatchObject({ category: "earthquake", summary: expect.stringContaining("& 津波なし") });
  });
});
