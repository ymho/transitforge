import { describe, expect, it, vi } from "vitest";

import { createMapboxHttpClient } from "./mapbox-http-client.js";

describe("createMapboxHttpClient", () => {
  it("既存ヘッダーを保ったまま正規ViewerのRefererを付ける", async () => {
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const client = createMapboxHttpClient({ fetch }, "https://app.ohmyki.com/path");

    await client.fetch("https://api.mapbox.com/search", {
      headers: { Accept: "application/json" },
    });

    const init = fetch.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Referer")).toBe("https://app.ohmyki.com/");
  });

  it("HTTPSではない参照元を拒否する", () => {
    expect(() => createMapboxHttpClient({ fetch: vi.fn() }, "http://app.ohmyki.com"))
      .toThrow("VIEWER_ORIGIN must be a public HTTPS origin");
  });
});
