import { describe, expect, it } from "vitest";

import { likelyOfficialWebsiteUrl } from "./official-website";

describe("likelyOfficialWebsiteUrl", () => {
  it("accepts a safe HTTPS venue site", () => {
    expect(likelyOfficialWebsiteUrl("https://www.tsutenkaku.co.jp/"))
      .toBe("https://www.tsutenkaku.co.jp/");
  });

  it.each([
    "http://example.jp/",
    "https://www.mapbox.com/place/example",
    "https://www.istockphoto.com/photo/example",
    "https://www.tripadvisor.jp/example",
    "https://user:secret@example.jp/",
  ])("rejects a non-official or unsafe URL: %s", (url) => {
    expect(likelyOfficialWebsiteUrl(url)).toBeUndefined();
  });
});
