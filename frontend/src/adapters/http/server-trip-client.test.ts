import { describe, expect, it, vi } from "vitest";
import { createTrip, TripRevisionConflict } from "@raiquora/trip/trip";
import { TripWriteRejected } from "../../usecases/trip-plan/server-trip-client";
import { HttpServerTripClient } from "./server-trip-client";
const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-13T01:00:00Z");
describe("Trip HTTP client", () => {
  it("does not label feasibility rejection as booking-change consent", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ version: "trip-api-v1", error: "feasibility-required" }), { status: 409 }));
    const client = new HttpServerTripClient("/api/trips/v1", request);
    await expect(client.mutate({ tripId: trip.id, baseRevision: 0, mutationId: "22222222-2222-4222-8222-222222222222",
      proposal: { tripId: trip.id, baseRevision: 0, summary: "案", patches: [] } })).rejects.toThrow("成立性が未確認または不成立");
  });
  it("sends revision/mutation contract and distinguishes conflict/reuse from network failure", async () => {
    const request = vi.fn<typeof fetch>(), client = new HttpServerTripClient("/api/trips/v1", request);
    const mutation = { tripId: trip.id, mutationId: "22222222-2222-4222-8222-222222222222", baseRevision: 0,
      proposal: { tripId: trip.id, baseRevision: 0, summary: "案", patches: [] } };
    const result = { version: "trip-api-v1", trip: { ...trip, revision: 1 }, revision: 1, mutationId: mutation.mutationId };
    request.mockResolvedValueOnce(new Response(JSON.stringify(result)));
    expect(await client.mutate(mutation)).toEqual(result.trip);
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ version: "trip-api-v1", operation: "mutate", ...mutation });
    for (const [error, type] of [["conflict", TripRevisionConflict], ["mutation-reused", TripWriteRejected]] as const) {
      request.mockResolvedValueOnce(new Response(JSON.stringify({ version: "trip-api-v1", error }), { status: 409 }));
      await expect(client.mutate(mutation)).rejects.toBeInstanceOf(type);
    }
    request.mockResolvedValueOnce(new Response(JSON.stringify({ ...result, mutationId: "wrong" })));
    await expect(client.mutate(mutation)).rejects.toThrow("Invalid mutation response");
  });
  it("uses versioned endpoint and session transport without owner claims", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ version: "trip-api-v1", trip })));
    const client = new HttpServerTripClient("/api/trips/v1", request);
    expect(await client.get(trip.id)).toEqual(trip);
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ version: "trip-api-v1", operation: "get", tripId: trip.id });
    expect(request.mock.calls[0]![1]?.credentials).toBe("same-origin");
  });
  it("reads the existing cursor list and archives through the owner-scoped API", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ version: "trip-api-v1", trips: [trip], nextAfterTripId: trip.id }))).mockResolvedValueOnce(new Response(JSON.stringify({ version: "trip-api-v1" })));
    const client = new HttpServerTripClient("/api/trips/v1", request);
    expect(await client.list({ limit: 20 })).toEqual({ trips: [trip], nextAfterTripId: trip.id });
    await client.archive(trip.id);
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ version: "trip-api-v1", operation: "archive", tripId: trip.id });
  });
  it("distinguishes not-found from auth/network/invalid response without stale cache", async () => {
    const request = vi.fn<typeof fetch>(); const client = new HttpServerTripClient("/api/trips/v1", request);
    request.mockResolvedValueOnce(new Response("", { status: 404 })); expect(await client.get(trip.id)).toBeUndefined();
    for (const status of [401, 501, 500]) {
      request.mockResolvedValueOnce(new Response("private error", { status }));
      await expect(client.get(trip.id)).rejects.toThrow("Trip API unavailable");
    }
    request.mockResolvedValueOnce(new Response(JSON.stringify({ version: "wrong", trip })));
    await expect(client.get(trip.id)).rejects.toThrow();
    request.mockResolvedValueOnce(new Response(JSON.stringify({ version: "trip-api-v1", trip: { ...trip, id: "22222222-2222-4222-8222-222222222222" } })));
    await expect(client.get(trip.id)).rejects.toThrow("Wrong Trip");
  });
});
