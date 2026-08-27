import type { FlightProvider } from "../ports/flight-provider.js";
import type { AgentOperation } from "../ports/agent-operation.js";

export function createFlightSearchOperation(provider: FlightProvider): AgentOperation {
  return async (request) => {
    const originAirportCode = airport(request.originAirportCode);
    const destinationAirportCode = airport(request.destinationAirportCode);
    const departureDate = typeof request.departureDate === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(request.departureDate) ? request.departureDate : undefined;
    if (!originAirportCode || !destinationAirportCode || !departureDate) return { statusCode: 400, body: { message: "航空便の検索条件が不正です" } };
    const result = await provider.search({ originAirportCode, destinationAirportCode, departureDate, ...(typeof request.nonStop === "boolean" ? { nonStop: request.nonStop } : {}), ...(integer(request.adults, 1, 9) ? { adults: request.adults as number } : {}), ...(integer(request.limit, 1, 10) ? { limit: request.limit as number } : {}) });
    return { body: { flights: result } };
  };
}
function airport(value: unknown): string | undefined { return typeof value === "string" && /^[A-Za-z]{3}$/u.test(value) ? value.toUpperCase() : undefined; }
function integer(value: unknown, min: number, max: number): boolean { return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max; }
