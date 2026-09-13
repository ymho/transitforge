import { describe, expect, it } from "vitest";
import { PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createTrip, type TripUpdateProposal } from "@raiquora/trip/trip";
import { reservationChangeKey } from "@raiquora/trip/reservation";
import { reservationFixture, reservationTripId } from "../../../../modules/trip/domain/reservation.fixture.js";
import { DynamoDbReservationRepository } from "./dynamodb-reservation-repository.js";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { ReservationApplication, type ReservationAuthority } from "../usecases/reservation-application.js";
import { TripApplication } from "../usecases/trip-application.js";
import { createTripApiHandler } from "../trip-handler.js";

const owner = { subject: "owner-A" }, other = { subject: "owner-B" };
const authority: ReservationAuthority = { confirmed: true, retainedFields: ["bookingReference", "provider", "providerItemId", "startsAt", "endsAt", "bookedAt"] };
const item = { id: "activity", type: "activity" as const, title: "体験", category: "experience" as const, schedule: { type: "unscheduled" as const } };
function setup() {
  const f = tripDynamoFixture(); const trip = createTrip(reservationTripId, "予約の旅", "2026-09-13T00:00:00Z", [item]); f.seed(trip);
  const repository = new DynamoDbReservationRepository("test-trips", f.client);
  const app = new ReservationApplication(f.repository, repository);
  const trips = new TripApplication(f.repository, f.repository, f.clock, app);
  const c = { operation: "create", reservation: reservationFixture() };
  const update = { tripId: trip.id, reservationId: c.reservation.id, baseRevision: 0 };
  return { ...f, tripRepository: f.repository, repository, app, trips, trip, c, update };
}
describe("owner-scoped Reservation Application / DynamoDB", () => {
  it("creates/imports once, gets private detail, lists only safe facts; Trip unchanged", async () => {
    const f = setup(); expect(await f.app.preview(owner, f.c)).toMatchObject({ confirmationRequired: true });
    const first = await f.app.execute(owner, f.c, authority); expect(await f.app.execute(owner, f.c, authority)).toEqual(first);
    expect(await f.app.execute(owner, { operation: "get", tripId: f.trip.id, reservationId: f.c.reservation.id })).toBeDefined();
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toEqual(f.c.reservation);
    expect(await f.trips.execute(owner, { version: "trip-api-v1", operation: "get", tripId: f.trip.id })).toMatchObject({ trip: f.trip });
  });
  it("allows explicit details, not private ordinary reads", async () => {
    const f = setup(); await f.app.execute(owner, f.c, authority);
    const detail = await f.app.execute(owner, { operation: "get", tripId: f.trip.id, reservationId: f.c.reservation.id });
    expect(detail.reservation).toMatchObject({ bookingReference: "PRIVATE-TEST-REFERENCE" });
    const list = await f.app.execute(owner, { operation: "list", tripId: f.trip.id });
    expect(JSON.stringify(list)).not.toMatch(/bookingReference|PRIVATE/);
    expect(await f.repository.list(other, f.trip.id)).toEqual([]);
    expect(await f.repository.get(other, f.trip.id, f.c.reservation.id)).toBeUndefined();
    expect(await f.repository.list(owner, "33333333-3333-4333-8333-333333333333")).toEqual([]);
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toEqual(f.c.reservation);
    expect(await f.repository.create(owner, { ...f.c.reservation, status: "unknown" }).catch((e) => e.code)).toBe("already-exists");
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toEqual(f.c.reservation);
    expect(await f.app.execute(other, { operation: "list", tripId: f.trip.id }).catch((e) => e.code)).toBe("not-found");
  });
  it("updates/cancels/unlinks/relinks with independent CAS, permits many records per item", async () => {
    const f = setup(); await f.app.execute(owner, f.c, authority);
    await f.app.execute(owner, { operation: "create", reservation: { ...f.c.reservation, id: "33333333-3333-4333-8333-333333333333" } }, authority);
    await f.app.execute(owner, { operation: "update", ...f.update, details: { kind: "activity", status: "not-booked" } }, authority);
    await expect(f.app.execute(owner, { operation: "cancel", ...f.update }, authority)).rejects.toMatchObject({ code: "conflict" });
    await f.app.execute(owner, { operation: "cancel", ...f.update, baseRevision: 1 }, authority);
    await f.app.execute(owner, { operation: "unlink", ...f.update, baseRevision: 2 }, authority);
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).not.toHaveProperty("itineraryItemId");
    await f.app.execute(owner, { operation: "link", ...f.update, baseRevision: 3, itineraryItemId: item.id }, authority);
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toMatchObject({ status: "cancelled", revision: 4, itineraryItemId: item.id });
    expect(await f.app.facts(owner, f.trip.id)).toHaveLength(2);
    expect(await f.repository.replace(owner, f.c.reservation, 0).catch((e) => e.code)).toBe("conflict");
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toMatchObject({ revision: 4 });
    expect(await f.trips.execute(owner, { version: "trip-api-v1", operation: "get", tripId: f.trip.id })).toMatchObject({ trip: f.trip });
  });
  it("rejects missing principal, Trip/item, body owner and raw data; requires trusted confirmation/retention", async () => {
    const f = setup();
    for (const value of [undefined, { subject: "" }]) {
      await expect(f.app.execute(value, f.c, authority)).rejects.toMatchObject({ code: "unauthenticated" });
      await expect(f.repository.list(value!, f.trip.id)).rejects.toMatchObject({ code: "unauthenticated" });
      await expect(f.repository.get(value!, f.trip.id, f.c.reservation.id)).rejects.toMatchObject({ code: "unauthenticated" });
      await expect(f.repository.create(value!, f.c.reservation)).rejects.toMatchObject({ code: "unauthenticated" });
      await expect(f.repository.replace(value!, f.c.reservation, 0)).rejects.toMatchObject({ code: "unauthenticated" });
    }
    await expect(f.app.execute(owner, f.c)).rejects.toMatchObject({ code: "confirmation-required" });
    await expect(f.app.execute(owner, f.c, { confirmed: true })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.app.execute(other, f.c, authority)).rejects.toMatchObject({ code: "not-found" });
    for (const bad of [{ ...f.c, ownerId: owner.subject }, { ...f.c, reservation: { ...f.c.reservation, raw: { token: "private" } } },
      { ...f.c, reservation: { ...f.c.reservation, itineraryItemId: "missing" } }]) await expect(f.app.execute(owner, bad, authority)).rejects.toMatchObject({ code: "invalid-input" });
    await f.app.execute(owner, f.c, authority);
    await expect(f.app.execute(owner, { operation: "link", ...f.update, itineraryItemId: "missing" }, authority)).rejects.toMatchObject({ code: "invalid-input" });
    await f.repository.get(owner, f.trip.id, f.c.reservation.id);
    await f.trips.execute(owner, { version: "trip-api-v1", operation: "archive", tripId: f.trip.id });
    await expect(f.app.execute(owner, { operation: "get", tripId: f.trip.id, reservationId: f.c.reservation.id })).rejects.toMatchObject({ code: "not-found" });
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toBeDefined(); // preserved history
  });
  it("reads every Query page before protection, rejects corruption and sanitizes SDK failures", async () => {
    const f = setup();
    for (let i = 0; i < 101; i++) await f.repository.create(owner, reservationFixture({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    expect(await f.app.facts(owner, f.trip.id)).toHaveLength(101);
    expect(f.commands.filter((c) => c instanceof QueryCommand)).toHaveLength(2);
    const broken = new DynamoDbReservationRepository("test", { send: async () => { throw new Error("PRIVATE-TEST-REFERENCE"); } });
    await expect(broken.list(owner, f.trip.id)).rejects.toThrow("unavailable");
    const first = [...f.records.values()].find((r) => r.reservation)!; first.revision = { N: "99" };
    await expect(f.repository.list(owner, f.trip.id)).rejects.toThrow("unavailable");
  });
  it("binds provider import to observed durable identity and explicit retention", async () => {
    const f = setup();
    const c = { ...f.c, reservation: { ...f.c.reservation, provider: "fixture", providerItemId: "product" } };
    await expect(f.app.execute(owner, c, authority)).rejects.toThrow("invalid-input");
    const source = { id: "proof", kind: "event" as const, provider: "fixture", sourceId: "product", retrievedAt: "2026-09-13T00:00:00Z", confidence: "observed" as const };
    await expect(f.app.execute(owner, c, { ...authority, providerEvidence: { ...source, sourceId: "wrong" } })).rejects.toThrow("invalid-input");
    await f.app.execute(owner, c, { ...authority, providerEvidence: source });
    expect(await f.repository.get(owner, f.trip.id, c.reservation.id)).toMatchObject({ provider: "fixture", providerItemId: "product" });
    expect(JSON.stringify(await f.app.facts(owner, f.trip.id))).not.toContain("provider");
  });
  it("CAS permits only one concurrent update, without blind re-link", async () => {
    const f = setup(); await f.app.execute(owner, f.c, authority);
    const outcomes = await Promise.allSettled([
      f.repository.replace(owner, { ...f.c.reservation, status: "cancelled" }, 0),
      f.repository.replace(owner, { ...f.c.reservation, status: "unknown" }, 0),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((o) => o.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
    const saved = await f.repository.get(owner, f.trip.id, f.c.reservation.id);
    expect(saved).toMatchObject({ revision: 1, itineraryItemId: item.id });
  });
  it("recovers an unknown write response by GET; retry with the old revision cannot apply twice", async () => {
    const f = setup(); await f.app.execute(owner, f.c, authority);
    let responseLost = false;
    const repository = new DynamoDbReservationRepository("test-trips", { send: async (command) => {
      const result = await f.client.send(command);
      if (command instanceof PutItemCommand && !responseLost) { responseLost = true; throw new Error("PRIVATE-TEST-REFERENCE"); }
      return result;
    } });
    const next = { ...f.c.reservation, status: "cancelled" as const };
    await expect(repository.replace(owner, next, 0)).rejects.toThrow("unavailable");
    expect(await repository.get(owner, f.trip.id, next.id)).toMatchObject({ status: "cancelled", revision: 1, itineraryItemId: item.id });
    await expect(repository.replace(owner, next, 0)).rejects.toThrow("conflict");
  });
});

describe("Trip protection and privacy", () => {
  it("reservation read failure leaves the Trip unchanged and does not create a success receipt", async () => {
    const f = setup();
    const trips = new TripApplication(f.tripRepository, f.tripRepository, f.clock, { facts: async () => { throw new Error("offline"); } });
    await expect(trips.execute(owner, { version: "trip-api-v1", operation: "mutate", tripId: f.trip.id, baseRevision: 0,
      mutationId: "44444444-4444-4444-8444-444444444444", proposal: { tripId: f.trip.id, baseRevision: 0, summary: "削除",
        patches: [{ type: "remove", itemId: item.id }] } })).rejects.toThrow();
    expect(await f.tripRepository.get(owner, f.trip.id)).toEqual(f.trip);
    expect([...f.records.values()].some((r) => r.sk?.S?.startsWith("MUTATION#"))).toBe(false);
  });
  it.each(["remove", "replace"] as const)("booked %s requires proposal/revision-bound confirmation; retry preserves history", async (type) => {
    const f = setup(); await f.app.execute(owner, f.c, authority);
    const proposal: TripUpdateProposal = { tripId: f.trip.id, baseRevision: 0, summary: "変更", patches: [type === "remove" ? { type, itemId: item.id } : { type, itemId: item.id, item: { ...item, title: "別の体験" } }] };
    const command = { version: "trip-api-v1", operation: "mutate", tripId: f.trip.id, baseRevision: 0, mutationId: "44444444-4444-4444-8444-444444444444", proposal };
    await expect(f.trips.execute(owner, command)).rejects.toMatchObject({ code: "confirmation-required" });
    const key = reservationChangeKey(proposal, await f.app.facts(owner, f.trip.id));
    await f.app.execute(owner, { operation: "link", ...f.update, itineraryItemId: item.id }, authority);
    await expect(f.trips.execute(owner, command, { confirmedReservationChange: key })).rejects.toMatchObject({ code: "confirmation-required" });
    const confirmation = { confirmedReservationChange: reservationChangeKey(proposal, await f.app.facts(owner, f.trip.id)) };
    const saved = await f.trips.execute(owner, command, confirmation);
    expect(await f.trips.execute(owner, command)).toEqual(saved); // receipt, no repeated side effects
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toMatchObject({ status: "booked", itineraryItemId: item.id, revision: 1 });
    await expect(f.trips.execute(owner, { ...command, mutationId: "55555555-5555-4555-8555-555555555555" }, confirmation)).rejects.toMatchObject({ code: "conflict" });
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toMatchObject({ revision: 1 });
  });
  it.each(["cancelled", "not-booked", "not-required", "unknown"] as const)("does not block %s; never cascades", async (status) => {
    const f = setup(); await f.app.execute(owner, { ...f.c, reservation: { ...f.c.reservation, status } }, authority);
    const proposal = { tripId: f.trip.id, baseRevision: 0, summary: "削除", patches: [{ type: "remove", itemId: item.id }] };
    await f.trips.execute(owner, { version: "trip-api-v1", operation: "mutate", tripId: f.trip.id, baseRevision: 0, mutationId: "44444444-4444-4444-8444-444444444444", proposal });
    expect(await f.repository.get(owner, f.trip.id, f.c.reservation.id)).toMatchObject({ status });
  });
  it("fails closed without a reservation reader and logs only categories (public gate stays closed)", async () => {
    const f = setup(), logs: unknown[] = [];
    const app = new TripApplication(f.tripRepository, f.tripRepository, f.clock);
    const command = { version: "trip-api-v1", operation: "mutate", tripId: f.trip.id, baseRevision: 0, mutationId: "44444444-4444-4444-8444-444444444444",
      proposal: { tripId: f.trip.id, baseRevision: 0, summary: "PRIVATE-TEST-REFERENCE", patches: [{ type: "remove", itemId: item.id }] } };
    const event = { body: JSON.stringify(command), requestContext: { http: { method: "POST" } } };
    const handler = createTripApiHandler(app, { authenticate: async () => owner, log: (e) => logs.push(e) });
    expect((await handler(event)).statusCode).toBe(501);
    expect(JSON.stringify(logs)).not.toContain("PRIVATE");
    expect((await createTripApiHandler()(event)).statusCode).toBe(501);
    expect(f.commands.filter((c) => c instanceof PutItemCommand)).toHaveLength(0);
  });
});
