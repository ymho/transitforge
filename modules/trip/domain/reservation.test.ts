import { describe, expect, it } from "vitest";
import { reservationStatuses, reservationKinds, validateReservation, reservationFact, validateReservationFact, bookedReservationChanges, reservationChangeKey, type Reservation } from "./reservation";
import { reservationFixture, reservationTripId } from "./reservation.fixture";
import type { TripUpdateProposal } from "./trip";

describe("independent Reservation contract", () => {
  it.each(reservationStatuses)("accepts status %s without inventing booking time", (status) => {
    const r = reservationFixture({ status }); expect(() => validateReservation(r)).not.toThrow();
    expect(r).not.toHaveProperty("bookedAt");
  });
  it.each(reservationKinds)("accepts %s with no item", (kind) => expect(() => validateReservation(reservationFixture({ kind, itineraryItemId: undefined }))).not.toThrow());
  it.each(["booked", "not-booked", "cancelled"])("never exposes private reference for %s", (status) => {
    const fact = reservationFact(reservationFixture({ status: status as Reservation["status"], provider: "private-provider", providerItemId: "private-id" }));
    expect(JSON.stringify(fact)).not.toMatch(/PRIVATE|provider|bookingReference/);
    expect(() => validateReservationFact(fact)).not.toThrow();
  });
  it.each([{ status: "change-required" }, { status: "selected" }, { raw: { token: "private" } }, { bookingUrl: "https://example.com" },
    { tripId: undefined }, { tripId: "" }, { id: "invalid" }, { revision: -1 }, { schemaVersion: 2 }, { providerItemId: "id" },
    { bookingReference: "x".repeat(201) }, { bookingReference: "\n" }, { bookingReference: " " },
    { startsAt: { at: "2026-09-22", timeZone: "Asia/Tokyo" } }, { endsAt: { at: "2026-09-22T09:00:00+09:00", timeZone: "Europe/Zurich" } },
    { startsAt: { at: "2026-09-22T09:00:00+09:00" } }, { bookedAt: "2026-09-22" }])("rejects invalid/unknown values without echo", (bad) => {
    expect(() => validateReservation({ ...reservationFixture(), ...bad } as Reservation)).toThrow();
  });
  it("reuses ZonedInstant, preserves crossing dates/zones, does not copy a schedule", () => {
    const startsAt = { at: "2026-09-22T23:00:00+09:00", timeZone: "Asia/Tokyo" }, endsAt = { at: "2026-09-23T12:00:00+02:00", timeZone: "Europe/Zurich" };
    const r = reservationFixture({ startsAt, endsAt, bookingReference: "x".repeat(200) });
    expect(() => validateReservation(r)).not.toThrow(); expect(reservationFact(r)).toMatchObject({ startsAt, endsAt });
    expect(() => validateReservation({ ...r, startsAt: endsAt, endsAt: startsAt })).toThrow();
  });
  it("protects booked replacement/removal only; confirmation tracks reservation revision", () => {
    const p: TripUpdateProposal = { tripId: reservationTripId, baseRevision: 0, summary: "削除", patches: [{ type: "remove", itemId: "activity" }] };
    const facts = reservationStatuses.map((status, revision) => reservationFact(reservationFixture({ status, revision })));
    expect(bookedReservationChanges(p, facts).map((r) => r.status)).toEqual(["booked"]);
    expect(reservationChangeKey(p, facts)).not.toBe(reservationChangeKey(p, facts.map((r) => ({ ...r, revision: r.revision + 1 }))));
    expect(bookedReservationChanges({ ...p, patches: [{ type: "move", itemId: "activity" }] }, facts)).toEqual([]);
  });
});
