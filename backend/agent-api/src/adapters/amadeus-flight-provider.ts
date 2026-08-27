import { availableExternalInformation, failedExternalInformation } from "@raiquora/trip/external-travel-information";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { FlightOffer, FlightSearchProvider, FlightSearchQuery, FlightSearchResult } from "@raiquora/trip/flight-search";
import type { FlightProviderCredentialsRepository } from "../ports/flight-provider.js";

interface HttpPort { fetch(input: string, init?: RequestInit): Promise<Response> }

export class AmadeusFlightProvider implements FlightSearchProvider {
  constructor(private readonly http: HttpPort, private readonly credentials: FlightProviderCredentialsRepository, private readonly now = () => new Date()) {}

  async search(query: FlightSearchQuery): Promise<ExternalTravelInformation<FlightSearchResult>> {
    try {
      const credentials = await this.credentials.load();
      if (!credentials) return failedExternalInformation({ code: "unauthorized", message: "航空便Providerが設定されていません", retryable: false });
      const baseUrl = credentials.baseUrl ?? "https://api.amadeus.com";
      const token = await this.accessToken(baseUrl, credentials.clientId, credentials.clientSecret);
      const url = new URL("/v2/shopping/flight-offers", baseUrl);
      for (const [key, value] of Object.entries({ originLocationCode: query.originAirportCode, destinationLocationCode: query.destinationAirportCode, departureDate: query.departureDate, adults: String(query.adults ?? 1), nonStop: String(query.nonStop ?? false), max: String(Math.max(1, Math.min(10, query.limit ?? 5))) })) url.searchParams.set(key, value);
      const response = await this.http.fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return failedExternalInformation({ code: response.status === 429 ? "rate_limited" : "unavailable", message: "航空便を検索できません", retryable: true });
      const retrievedAt = this.now();
      return availableExternalInformation({ offers: flightOffers(await response.json()) }, [{ id: `flight:amadeus:${query.originAirportCode}:${query.destinationAirportCode}:${query.departureDate}:${retrievedAt.toISOString()}`, kind: "flight", provider: "amadeus-self-service", sourceUrl: url.toString(), retrievedAt: retrievedAt.toISOString(), validUntil: new Date(retrievedAt.getTime() + 15 * 60_000).toISOString(), attribution: "Amadeus Self-Service APIs", confidence: "provider-schedule" }], retrievedAt);
    } catch { return failedExternalInformation({ code: "unavailable", message: "航空便を検索できません", retryable: true }); }
  }

  private async accessToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
    const response = await this.http.fetch(new URL("/v1/security/oauth2/token", baseUrl).toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }), signal: AbortSignal.timeout(8_000) });
    const value: unknown = await response.json();
    if (!response.ok || !isRecord(value) || typeof value.access_token !== "string") throw new Error("token unavailable");
    return value.access_token;
  }
}

function flightOffers(value: unknown): FlightOffer[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.slice(0, 10).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || !Array.isArray(raw.itineraries)) return [];
    const segments = raw.itineraries.flatMap((itinerary) => isRecord(itinerary) && Array.isArray(itinerary.segments) ? itinerary.segments : []).flatMap((segment) => {
      if (!isRecord(segment) || !isRecord(segment.departure) || !isRecord(segment.arrival) || typeof segment.carrierCode !== "string" || typeof segment.number !== "string" || typeof segment.departure.iataCode !== "string" || typeof segment.departure.at !== "string" || typeof segment.arrival.iataCode !== "string" || typeof segment.arrival.at !== "string") return [];
      return [{ departureAirportCode: segment.departure.iataCode, arrivalAirportCode: segment.arrival.iataCode, departureAt: segment.departure.at, arrivalAt: segment.arrival.at, carrierCode: segment.carrierCode, flightNumber: segment.number }];
    });
    if (segments.length === 0) return [];
    const price = isRecord(raw.price) && typeof raw.price.grandTotal === "string" && typeof raw.price.currency === "string" ? { amount: raw.price.grandTotal, currency: raw.price.currency } : undefined;
    return [{ providerOfferId: raw.id, segments, nonStop: segments.length === 1, bookable: typeof raw.bookable === "boolean" ? raw.bookable : "unknown", ...(typeof raw.numberOfBookableSeats === "number" ? { remainingSeats: raw.numberOfBookableSeats } : {}), ...(price ? { price } : {}) }];
  });
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
