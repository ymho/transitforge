import type { HttpClient } from "./http-accommodation-provider.js";
import { ProviderBoundaryError, record } from "./fixed-egress-provider-contract.js";

/** Bounded response reads; no redirects carrying the accessKey to another host. */
export function fixedEgressHttpClient(fetcher: typeof fetch = globalThis.fetch): HttpClient {
  return { async fetch(url, init) {
    let response: Response;
    try { response = await fetcher(url, { ...init, redirect: "error" }); }
    catch { throw new ProviderBoundaryError(init.signal.aborted ? "provider_timeout" : "unavailable"); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderBoundaryError(response.status === 429 ? "provider_throttled" : response.status >= 500 ? "provider_5xx" : "provider_4xx");
    }
    return { ok: true, async json() {
      const reader = response.body?.getReader();
      if (!reader) throw new ProviderBoundaryError("malformed_response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 262_144) throw new ProviderBoundaryError("oversized_result");
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        // A provider must never reflect credentials in names, links or other returned fields.
        const credentials = [init.headers.accessKey, new URL(url).searchParams.get("applicationId")];
        const value: unknown = JSON.parse(text);
        const serialized = JSON.stringify(value);
        if (credentials.some(secret => secret && serialized.includes(secret))) throw new Error();
        if (!record(value) || !Array.isArray(value.hotels) || value.hotels.some(hotel => !validHotel(hotel))) throw new Error();
        return value;
      } catch (error) {
        if (error instanceof ProviderBoundaryError) throw error;
        throw new ProviderBoundaryError(init.signal.aborted ? "provider_timeout" : "malformed_response");
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } };
  } };
}
function validHotel(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(validHotel);
  if (!record(value) || !record(value.hotelBasicInfo)) return false;
  return Number.isSafeInteger(value.hotelBasicInfo.hotelNo) && typeof value.hotelBasicInfo.hotelName === "string" && !!value.hotelBasicInfo.hotelName.trim();
}
