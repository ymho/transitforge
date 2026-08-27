import { describe, expect, it, vi } from "vitest";
import { AmadeusFlightProvider } from "./amadeus-flight-provider";

describe("AmadeusFlightProvider", () => {
  it("normalizes schedule availability and price with evidence", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "offer-1", bookable: true, numberOfBookableSeats: 3, price: { grandTotal: "12000", currency: "JPY" }, itineraries: [{ segments: [{ carrierCode: "XX", number: "123", departure: { iataCode: "KIX", at: "2026-09-01T21:00:00" }, arrival: { iataCode: "HKG", at: "2026-09-02T00:10:00" } }] }] }] }), { status: 200 }));
    const provider = new AmadeusFlightProvider({ fetch }, { load: async () => ({ clientId: "id", clientSecret: "secret" }) }, () => new Date("2026-08-27T00:00:00Z"));
    const result = await provider.search({ originAirportCode: "KIX", destinationAirportCode: "HKG", departureDate: "2026-09-01" });
    expect(result.data?.offers[0]).toEqual(expect.objectContaining({ nonStop: true, bookable: true, price: { amount: "12000", currency: "JPY" } }));
    expect(result.evidence[0]?.provider).toBe("amadeus-self-service");
  });

  it("keeps availability unknown when no provider is configured", async () => {
    const provider = new AmadeusFlightProvider({ fetch: vi.fn() }, { load: async () => undefined });
    expect((await provider.search({ originAirportCode: "KIX", destinationAirportCode: "HKG", departureDate: "2026-09-01" })).status).toBe("unavailable");
  });
});
