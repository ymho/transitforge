import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import type { TravelProviderSearch } from "@raiquora/trip/travel-provider";
import { createAccommodationOffering } from "@raiquora/trip/travel-provider";
import { isPriceObservation } from "@raiquora/trip/money";
import { providerSearchFrom } from "../contracts/accommodation-search.js";

import { ProviderBoundaryError, providerErrorRetryable, type ProviderErrorCode } from "../ports/provider-boundary-error.js";

export const providerRequestBytes = 2_048;
export const providerResponseBytes = 32_768;
export { ProviderBoundaryError } from "../ports/provider-boundary-error.js";
export type FixedEgressRequest = { operation: "search_accommodation"; request: TravelProviderSearch; requestId?: string };
export type FixedEgressResponse = { ok: true; accommodations: readonly AccommodationOffering[] }
  | { ok: false; error: { code: ProviderErrorCode; retryable: boolean } };
export function failure(code: ProviderErrorCode): FixedEgressResponse {
  return { ok: false, error: { code, retryable: providerErrorRetryable[code] } };
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("invalid fields");
}
export function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).length; }
export function parseProviderRequest(value: unknown): FixedEgressRequest {
  try {
    if (!record(value) || byteLength(value) > providerRequestBytes) throw new Error();
    keys(value, ["operation", "request", "requestId"]);
    if (value.operation !== "search_accommodation" || !record(value.request)) throw new Error();
    keys(value.request, ["destination", "checkInDate", "checkOutDate", "adults", "limit"]);
    if (value.request.adults === undefined || value.request.limit === undefined) throw new Error();
    if (value.requestId !== undefined && (typeof value.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.requestId))) throw new Error();
    const request = providerSearchFrom(value.request);
    for (const date of [request.checkInDate, request.checkOutDate]) {
      if (new Date(date).toISOString().slice(0, 10) !== date) throw new Error();
    }
    return { operation: value.operation, request, ...(value.requestId ? { requestId: value.requestId as string } : {}) };
  } catch { throw new ProviderBoundaryError("invalid_request"); }
}
export function parseProviderResponse(value: unknown, request: TravelProviderSearch): FixedEgressResponse {
  if (byteLength(value) > providerResponseBytes) throw new ProviderBoundaryError("oversized_result");
  try {
    if (!record(value)) throw new Error();
    if (value.ok === false) {
      keys(value, ["ok", "error"]);
      if (!record(value.error)) throw new Error();
      keys(value.error, ["code", "retryable"]);
      const code = value.error.code;
      if (typeof code !== "string" || !Object.hasOwn(providerErrorRetryable, code) || value.error.retryable !== providerErrorRetryable[code as ProviderErrorCode]) throw new Error();
      return failure(code as ProviderErrorCode);
    }
    keys(value, ["ok", "accommodations"]);
    if (value.ok !== true || !Array.isArray(value.accommodations) || value.accommodations.length > request.limit) throw new Error();
    const accommodations = value.accommodations.map(item => {
      if (!record(item)) throw new Error();
      keys(item, ["kind", "provider", "providerItemId", "name", "checkInDate", "checkOutDate", "availability", "bookingUrl", "imageUrl", "areaName", "address", "latitude", "longitude", "reviewAverage", "reviewCount", "price"]);
      if (item.kind !== "accommodation" || item.provider !== "travel-provider" || item.checkInDate !== request.checkInDate || item.checkOutDate !== request.checkOutDate || !["available", "unknown"].includes(item.availability as string)) throw new Error();
      for (const field of ["providerItemId", "name"]) if (typeof item[field] !== "string" || !(item[field] as string).trim()) throw new Error();
      for (const field of ["providerItemId", "name", "areaName", "address", "bookingUrl", "imageUrl"]) {
        if (item[field] !== undefined && (typeof item[field] !== "string" || (item[field] as string).length > 2_048)) throw new Error();
      }
      for (const field of ["bookingUrl", "imageUrl"]) if (item[field] !== undefined) {
        const url = new URL(item[field] as string);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error();
      }
      for (const [field, min, max] of [["latitude", -90, 90], ["longitude", -180, 180], ["reviewAverage", 0, 5], ["reviewCount", 0, Number.MAX_SAFE_INTEGER]] as const) {
        const number = item[field];
        if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max || field === "reviewCount" && !Number.isInteger(number))) throw new Error();
      }
      if (item.price !== undefined && !isPriceObservation(item.price)) throw new Error();
      return createAccommodationOffering("travel-provider", request, item as unknown as AccommodationOffering);
    });
    return { ok: true, accommodations };
  } catch { throw new ProviderBoundaryError("malformed_response"); }
}
