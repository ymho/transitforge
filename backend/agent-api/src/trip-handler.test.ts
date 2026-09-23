import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createTripApiHandler } from "./trip-handler.js";
import { boundedTrip, tripApiLimits, TripResourceError } from "./contracts/trip-api.js";

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
  it("wires typed adoption preview/confirm authority and keeps retry, stale and owner failures explicit", async () => {
    const confirmationKey = "a".repeat(64), mutationId = "22222222-2222-4222-8222-222222222222";
    const base = { version: "trip-api-v1", conversationId: "conversation-1", candidateSetId: "set-1", candidateSetRevision: 2,
      variantId: "variant-1", tripId: trip().id, baseTripRevision: 0, mutationId };
    const execute = vi.fn(), executeAdoption = vi.fn(async (principal, request, authority) => {
      if (principal.subject !== "trusted") throw new TripResourceError("not-found");
      if (request.baseTripRevision !== 0) throw new TripResourceError("conflict");
      if (request.operation === "confirm" && authority?.confirmationKey !== confirmationKey) throw new TripResourceError("confirmation-required");
      return request.operation === "preview" ? { status: "confirmation-required" as const, confirmationKey, preview: { proposal: { tripId: trip().id, baseRevision: 0, summary: "案", patches: [] }, componentMap: [], changes: { added: 0, replaced: 0, removed: 0 } } }
        : { status: "saved" as const, trip: { ...trip(), revision: 1 }, revision: 1, mutationId };
    });
    const handler = createTripApiHandler({ execute, executeAdoption }, { authenticate: async () => ({ subject: "trusted" }) });
    const preview = await handler(event({ ...base, operation: "preview-plan-adoption" })); expect(preview.statusCode).toBe(200);
    const confirm = await handler(event({ ...base, operation: "confirm-plan-adoption", confirmationKey })); expect(confirm.statusCode).toBe(200);
    const retry = await handler(event({ ...base, operation: "confirm-plan-adoption", confirmationKey }));
    expect({ statusCode: retry.statusCode, body: retry.body }).toEqual({ statusCode: confirm.statusCode, body: confirm.body });
    expect(execute).not.toHaveBeenCalled(); expect(executeAdoption.mock.calls[0]?.[0]).toEqual({ subject: "trusted" });
    expect(executeAdoption.mock.calls[0]?.[2]).toBeUndefined(); expect(executeAdoption.mock.calls[1]?.[2]).toEqual({ confirmationKey });
    expect((await handler(event({ ...base, operation: "confirm-plan-adoption", confirmationKey: "fake" }))).statusCode).toBe(400);
    expect((await handler(event({ ...base, operation: "preview-plan-adoption", baseTripRevision: 9 }))).statusCode).toBe(409);
    const other = createTripApiHandler({ execute, executeAdoption }, { authenticate: async () => ({ subject: "other" }) });
    expect((await other(event({ ...base, operation: "preview-plan-adoption" }))).statusCode).toBe(404);
  });
});
