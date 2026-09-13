import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createTripApiHandler } from "./trip-handler.js";
import { boundedTrip, tripApiLimits } from "./contracts/trip-api.js";

const trip = () => createTrip("11111111-1111-4111-8111-111111111111", "private itinerary", "2026-09-13T01:00:00Z");
const event = (body: unknown) => ({ requestContext: { http: { method: "POST" } }, body: JSON.stringify(body) });
describe("Trip HTTP authentication and privacy boundary", () => {
  it("has no enabled public handler without both application and a trusted verifier", async () => {
    const execute = vi.fn(), request = event({ version: "trip-api-v1", operation: "list", ownerId: "forged" });
    expect((await createTripApiHandler()(request)).statusCode).toBe(501);
    expect((await createTripApiHandler({ execute })(request)).statusCode).toBe(501);
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects missing authentication before inspecting forged body identity", async () => {
    const execute = vi.fn(), handler = createTripApiHandler({ execute }, { authenticate: async () => undefined });
    expect((await handler(event({ ownerId: "fake", userId: "fake" }))).statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it("passes only the verifier's principal, never logs body/error/provider tokens", async () => {
    const execute = vi.fn(async (_principal: unknown, _value: unknown) => { throw new Error("private-party-secret-query"); }), log = vi.fn();
    const handler = createTripApiHandler({ execute }, { authenticate: async () => ({ subject: "trusted" }), log });
    const response = await handler(event({ version: "trip-api-v1", operation: "create", trip: trip() }));
    expect(execute.mock.calls[0]?.[0]).toEqual({ subject: "trusted" });
    expect(response.statusCode).toBe(501);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|trusted|query|itinerary/);
    expect(response.body).not.toContain("private");
  });
  it("bounds UTF-8 and base64 bodies before Application parsing", async () => {
    const execute = vi.fn(), handler = createTripApiHandler({ execute }, { authenticate: async () => ({ subject: "a" }) });
    const body = JSON.stringify({ text: "旅".repeat(tripApiLimits.bodyBytes / 2) });
    expect((await handler({ ...event(null), body })).statusCode).toBe(413);
    expect((await handler({ ...event(null), body: Buffer.from(body).toString("base64"), isBase64Encoded: true })).statusCode).toBe(413);
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects items, assumptions, constraints and string excess without truncating", () => {
    const item = { id: "i", title: "休憩", type: "activity", category: "free-time", schedule: { type: "unscheduled" } };
    for (const value of [
      { ...trip(), items: Array.from({ length: 101 }, (_, index) => ({ ...item, id: String(index) })) },
      { ...trip(), request: { constraints: Array(101).fill({}), assumptions: [] } },
      { ...trip(), request: { constraints: [], assumptions: Array(101).fill({}) } },
      { ...trip(), title: "x".repeat(4097) },
    ]) expect(() => boundedTrip(value)).toThrow("payload-too-large");
    expect(boundedTrip(trip())).toEqual(trip());
  });
});
