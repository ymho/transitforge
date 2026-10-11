import { expect, it, vi } from "vitest";
import { MapboxServiceAreaLookup } from "./mapbox-service-area-lookup.js";

const feature = (code: string, country = "JP") => ({ properties: { context: { country: { country_code: country }, region: { region_code_full: code } } } });
it("resolves ISO prefecture codes and caches request-scoped lookups", async () => {
  const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ features: [feature("JP-32")] })));
  const lookup = new MapboxServiceAreaLookup({ fetch }, { load: async () => ({ accessToken: "fixture" }) });
  expect(await lookup.resolve({ latitude: 35.4, longitude: 132.7 })).toEqual({ country: "JP", prefecture: "島根県" });
  await lookup.resolve({ latitude: 35.4, longitude: 132.7 }); expect(fetch).toHaveBeenCalledTimes(1);
  expect(new URL(fetch.mock.calls[0]![0]).searchParams.get("longitude")).toBe("132.7");
});
it("does not promote ambiguous names, failures or missing country data", async () => {
  const responses = [new Response(JSON.stringify({ features: [feature("JP-26"), feature("JP-02")] })), new Response("failure", { status: 503 }), new Response(JSON.stringify({ features: [{ properties: { context: { region: { name: "京都府" } } } }] }))];
  const lookup = new MapboxServiceAreaLookup({ fetch: async () => responses.shift()! }, { load: async () => ({ accessToken: "fixture" }) });
  for (const query of ["同名施設", "通信失敗", "国不明"]) expect(await lookup.resolve({ query })).toBeUndefined();
});
