import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixedEgressProviderHandler } from "./fixed-egress-provider-handler.js";
import { HttpAccommodationProvider } from "./http-accommodation-provider.js";
import { fixedEgressHttpClient } from "./fixed-egress-http-client.js";

const request = { destination: "京都", checkInDate: "2026-10-01", checkOutDate: "2026-10-02", adults: 1, limit: 3 };
const event = { operation: "search_accommodation", request, requestId: "execution-1" };
const hotel = { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: "宿", hotelMinCharge: 8000 } }]] };
const credentials = { applicationId: "fixture-app-id", accessKey: "fixture-access-secret", hotelSearchUrl: "https://provider.example/search" };
function handler(fetcher: typeof fetch, availability = false) {
  return createFixedEgressProviderHandler(new HttpAccommodationProvider(fixedEgressHttpClient(fetcher), {
    load: async () => ({ ...credentials, ...(availability ? { vacantHotelSearchUrl: "https://provider.example/vacant" } : {}) }),
  }));
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("fixed egress handler / HTTP boundary", () => {
  it("maps provider raw JSON to a minimal validated offering", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(hotel));
    const result = await handler(fetcher)(event);
    expect(result).toMatchObject({ ok: true, accommodations: [{ providerItemId: "42", availability: "unknown", price: { price: { amountMinor: 8000 } } }] });
    expect(JSON.stringify(result)).not.toContain("hotelBasicInfo");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });
  it.each([
    { ...event, operation: "fetch" }, { ...event, url: "https://evil.example" },
    { ...event, request: { ...request, url: "https://evil.example" } },
    { ...event, request: { ...request, headers: {} } },
    { ...event, request: { ...request, applicationId: "caller" } },
    { ...event, request: { ...request, limit: 6 } },
    { ...event, request: { ...request, checkInDate: "2026-02-30" } },
    { ...event, requestId: "Bearer secret" }, { ...event, token: "secret" },
    { ...event, request: { ...request, destination: "x".repeat(3000) } },
  ])("rejects invalid or arbitrary proxy requests before credentials/HTTP", async input => {
    const search = vi.fn();
    expect(await createFixedEgressProviderHandler({ search })(input)).toEqual({ ok: false, error: { code: "invalid_request", retryable: false } });
    expect(search).not.toHaveBeenCalled();
  });
  it.each([[400, "provider_4xx", false], [401, "provider_4xx", false], [429, "provider_throttled", true], [500, "provider_5xx", true], [503, "provider_5xx", true]])("normalizes %s without retry or raw body", async (status, code, retryable) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("fixture-access-secret", { status: status as number }));
    expect(await handler(fetcher)(event)).toEqual({ ok: false, error: { code, retryable } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("normalizes HTTP timeout after 8 seconds", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("fixture-access-secret")), { once: true });
    }));
    const result = handler(fetcher)(event);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await result).toEqual({ ok: false, error: { code: "provider_timeout", retryable: true } });
  });
  it.each([null, {}, { hotels: [{}] }, { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: credentials.accessKey } }]] }, { hotels: [[{ hotelBasicInfo: { hotelNo: 42, hotelName: credentials.applicationId } }]] }])("rejects malformed and reflected credential responses", async body => {
    expect(await handler(vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)))(event)).toEqual({ ok: false, error: { code: "malformed_response", retryable: false } });
  });
  it("rejects invalid JSON and an oversized streaming body", async () => {
    for (const [body, code] of [["{", "malformed_response"], ["x".repeat(262145), "oversized_result"]]) {
      expect(await handler(vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))(event)).toMatchObject({ ok: false, error: { code } });
    }
  });
  it("rejects oversized normalized results", async () => {
    const result = await createFixedEgressProviderHandler({ search: async () => [{ name: "x".repeat(32769) }] as never })(event);
    expect(result).toMatchObject({ ok: false, error: { code: "oversized_result", retryable: false } });
  });
  it("keeps discovery as unknown availability when vacancy lookup fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(hotel)).mockResolvedValueOnce(new Response("secret", { status: 500 }));
    expect(await handler(fetcher, true)(event)).toMatchObject({ ok: true, accommodations: [{ availability: "unknown" }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not log or serialize credentials or internal exceptions", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const result = await createFixedEgressProviderHandler({ search: async () => { throw new Error(JSON.stringify(credentials)); } })(event);
    expect(result).toEqual({ ok: false, error: { code: "unavailable", retryable: true } });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
