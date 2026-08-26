import type { TravelProviderSearch } from "@raiquora/trip/travel-provider";
import { type JsonObject, RequestError } from "../contracts/agent-request.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { AccommodationProvider } from "../ports/travel-provider.js";

export function createAccommodationSearchOperation(provider: AccommodationProvider): AgentOperation {
  return async (request, context) => ({ body: { accommodations: await provider.search(providerSearchFrom(request), context.requestId) } });
}

export function providerSearchFrom(value: JsonObject): TravelProviderSearch {
  const destination = value.destination;
  if (typeof destination !== "string" || !destination.trim()) throw new RequestError(400, "destinationが必要です。");
  if (destination.trim().length > 80) throw new RequestError(400, "destinationが長すぎます。");
  const checkInDate = calendarDate(value.checkInDate, "checkInDate");
  const checkOutDate = calendarDate(value.checkOutDate, "checkOutDate");
  const nights = (Date.parse(checkOutDate) - Date.parse(checkInDate)) / 86_400_000;
  if (nights <= 0) throw new RequestError(400, "checkOutDateはcheckInDateより後にしてください。");
  if (nights > 31) throw new RequestError(400, "宿泊日数は31泊以下にしてください。");
  const adults = boundedInteger(value.adults ?? 1, 1, 10, "adultsは1から10にしてください。");
  const limit = boundedInteger(value.limit ?? 3, 1, 5, "limitは1から5にしてください。");
  return { destination: destination.trim(), checkInDate, checkOutDate, adults, limit };
}

function calendarDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new RequestError(400, `${field}はYYYY-MM-DD形式にしてください。`);
  }
  return value;
}
function boundedInteger(value: unknown, minimum: number, maximum: number, message: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new RequestError(400, message);
  return value as number;
}
