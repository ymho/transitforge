import { describe, expect, it, vi } from "vitest";
import { HttpTripSharingClient } from "./trip-sharing-client";
import { HttpServerTripClient } from "./server-trip-client";
import { createTrip } from "@raiquora/trip/trip";
const tripId = "11111111-1111-4111-8111-111111111111", grantId = "22222222-2222-4222-8222-222222222222";
describe("share transport privacy", () => {
  it("redeems via authenticated POST only, no URL secret/owner and no cache", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ version: "trip-sharing-v1", tripId, role: "viewer" })));
    const client = new HttpTripSharingClient(request);
    await expect(client.redeem({ tripId, grantId, secret: "s".repeat(43) })).resolves.toEqual({ tripId, role: "viewer" });
    const [url, init] = request.mock.calls[0]!; expect(url).toBe("/api/trips/sharing/v1");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(init!.body).not.toMatch(/owner|principal/);
  });
  it("allowlists management views and rejects private Reservation payloads", async () => {
    const request = vi.fn<typeof fetch>(), client = new HttpTripSharingClient(request);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ version: "trip-sharing-v1", participants: [], grants: [{
      id: grantId, tripId, role: "viewer", version: 0, createdAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-25T00:00:00.000Z",
      ownerSubject: "private-owner", secretHash: "private-hash",
    }] })));
    expect(JSON.stringify(await client.manage(tripId))).not.toMatch(/private|secretHash|ownerSubject/);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ version: "trip-sharing-v1", facts: [{
      reservationId: grantId, revision: 0, status: "booked", kind: "activity", bookingReference: "PRIVATE",
    }] })));
    await expect(client.reservationFacts(tripId)).rejects.toThrow();
    request.mockRejectedValueOnce(new Error("private details")); await expect(client.reservationFacts(tripId)).rejects.toThrow();
  });
  it("role comes from current Trip read, cleared on failure and never defaults to editor/owner", async () => {
    const request = vi.fn<typeof fetch>(), client = new HttpServerTripClient("/api/trips/v1", request);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ version: "trip-api-v1", trip: createTrip(tripId, "trip", "2026-09-18T00:00:00Z"), role: "viewer" })));
    await client.get(tripId); expect(client.getRole(tripId)).toBe("viewer");
    request.mockResolvedValueOnce(new Response("", { status: 404 })); await client.get(tripId); expect(client.getRole(tripId)).toBeUndefined();
  });
});
