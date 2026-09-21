import { validateTripRequest, type TripRequest } from "./trip-request";

/** Pre-Trip conditions use the same value object, with no adopted item references. */
export function parseConsultationRequest(value: unknown): TripRequest {
  const raw = JSON.stringify(value);
  if (!raw || new TextEncoder().encode(raw).length > 16_384) throw new Error("Conditions exceed limit");
  const request = JSON.parse(raw) as TripRequest;
  validateTripRequest(request, []);
  if (request.constraints.length > 40 || request.assumptions.length > 40) throw new Error("Too many conditions");
  return request;
}
