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

it("coalesces concurrent identical lookups before the first response arrives", async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const fetch = vi.fn(() => pending);
  const lookup = new MapboxServiceAreaLookup({ fetch }, { load: async () => ({ accessToken: "fixture" }) });
  const calls = Array.from({ length: 100 }, () => lookup.resolve({ latitude: 35.4, longitude: 132.7 }));
  expect(calls.every(call => call === calls[0])).toBe(true);
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(new Response(JSON.stringify({ features: [feature("JP-32")] })));
  expect((await Promise.all(calls)).every(value => value?.prefecture === "島根県")).toBe(true);
});

it("bounds unique geography calls and does not retry cached failures", async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("limited", { status: 429 }));
  const lookup = new MapboxServiceAreaLookup({ fetch }, { load: async () => ({ accessToken: "fixture" }) });
  const queries = Array.from({ length: 256 }, (_unused, i) => ({ query: `施設${i}` }));
  await Promise.all(queries.map(query => lookup.resolve(query)));
  expect(fetch).toHaveBeenCalledTimes(24);
  await Promise.all(queries.map(query => lookup.resolve(query)));
  expect(fetch).toHaveBeenCalledTimes(24);
  expect(fetch.mock.calls.every(([_url, init]) => init?.redirect === "error" && init.signal instanceof AbortSignal)).toBe(true);
});

it("does not retry a transport or redirect failure", async () => {
  const fetch = vi.fn(async () => { throw new TypeError("network or redirect error"); });
  const lookup = new MapboxServiceAreaLookup({ fetch }, { load: async () => ({ accessToken: "fixture" }) });
  await Promise.all(Array.from({ length: 100 }, () => lookup.resolve({ query: "同じ場所" })));
  expect(fetch).toHaveBeenCalledTimes(1);
});
