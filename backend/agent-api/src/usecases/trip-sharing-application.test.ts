import { describe, expect, it, vi } from "vitest";
import { GetItemCommand, QueryCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { createTrip, type Trip } from "@raiquora/trip/trip";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { DynamoDbTripSharing } from "../adapters/dynamodb-trip-sharing.js";
import { CryptographicShareSecret } from "../adapters/share-secret.js";
import { TripSharingApplication } from "./trip-sharing-application.js";
import { TripApplication } from "./trip-application.js";
import { parseSharingCommand } from "../contracts/trip-sharing-api.js";
import { createTripSharingHandler } from "../trip-sharing-handler.js";
import { previewInTripReplan } from "@raiquora/trip/in-trip-replan";
import { reservationChangeKey, type ReservationFact } from "@raiquora/trip/reservation";

const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const owner = { subject: "owner-A" }, guest = { subject: "guest-B" }, stranger = { subject: "stranger-C" };
function setup(oldEnvelope = false) {
  const f = tripDynamoFixture(), trip = createTrip(id, "共有旅行", "2026-09-13T00:00:00.000Z"); f.seed(trip, owner.subject, oldEnvelope);
  const repo = new DynamoDbTripSharing("test-trips", f.client, f.clock), crypto = new CryptographicShareSecret();
  const sharing = new TripSharingApplication(f.repository, repo, crypto, repo, f.clock, { facts: async () => [] });
  const trips = new TripApplication(f.repository, f.repository, f.clock, { facts: async () => [] }, undefined, sharing);
  const call = (principal: typeof owner, operation: string, fields: object = {}) => sharing.execute(principal, { version: "trip-sharing-v1", operation, ...fields });
  const grant = async (role = "viewer") => await call(owner, "create-grant", { tripId: id, role }) as unknown as { secret: string; grant: { id: string; version: number } };
  const redeem = (g: Awaited<ReturnType<typeof grant>>, principal = guest, tripId = id) => call(principal, "redeem", { tripId, grantId: g.grant.id, secret: g.secret });
  const get = (principal = guest) => trips.execute(principal, { version: "trip-api-v1", operation: "get", tripId: id });
  const mutate = (principal = guest, baseRevision = 0, mutationId = crypto.id()) => trips.execute(principal, {
    version: "trip-api-v1", operation: "mutate", tripId: id, baseRevision, mutationId,
    proposal: { tripId: id, baseRevision, summary: "休憩の提案", patches: [{ type: "add", item: {
      id: `rest-${baseRevision}`, type: "activity", title: "休憩", category: "free-time", schedule: { type: "unscheduled" },
    } }] },
  });
  return { ...f, repo, crypto, sharing, trips, call, grant, redeem, get, mutate };
}
describe("Trip sharing independent authorization and existing CAS", () => {
  it.each([false, true])("owner → viewer → editor → CAS → revoke, legacy envelope=%s", async (legacy) => {
    const f = setup(legacy), g = await f.grant(); await f.redeem(g);
    expect((await f.get()).role).toBe("viewer");
    await expect(f.mutate()).rejects.toThrow("not-found");
    const editor = await f.grant("editor"); await f.redeem(editor);
    const result = await f.mutate(); expect((result.trip as Trip).revision).toBe(1);
    expect((await f.repository.get(owner, id))?.items).toHaveLength(1);
    expect(await f.repository.get(guest, id)).toBeUndefined(); // No second Trip.
    await expect(f.mutate(owner, 0)).rejects.toThrow("conflict");
    await f.call(owner, "revoke-grant", { tripId: id, grantId: editor.grant.id, baseVersion: 0 });
    await expect(f.get()).rejects.toThrow("not-found"); await expect(f.redeem(editor)).rejects.toThrow("not-found");
    expect((await f.get(owner)).role).toBe("owner");
  });
  it("guessed Trip, wrong secret, cross-Trip grant and unknown grant have the same denial", async () => {
    const f = setup(), g = await f.grant();
    await expect(f.get(stranger)).rejects.toThrow("not-found");
    for (const fields of [ { tripId: other, grantId: g.grant.id, secret: g.secret },
      { tripId: id, grantId: other, secret: g.secret }, { tripId: id, grantId: g.grant.id, secret: f.crypto.issue().secret } ]) {
      await expect(f.call(guest, "redeem", fields)).rejects.toThrow("not-found");
    }
    await expect(f.call(guest, "redeem", { tripId: id, grantId: g.grant.id })).rejects.toThrow("not-found");
  });
  it("does not trust body identities or permit editor management/escalation/archive", async () => {
    const f = setup(), g = await f.grant("editor"); await f.redeem(g);
    for (const role of ["owner", "admin"]) expect(() => parseSharingCommand({ version: "trip-sharing-v1", operation: "create-grant", tripId: id, role })).toThrow();
    for (const key of ["ownerSubject", "principalSubject", "owner", "roleOverride"]) {
      await expect(f.call(guest, "manage", { tripId: id, [key]: owner.subject })).rejects.toThrow("invalid-input");
    }
    await expect(f.call(guest, "manage", { tripId: id })).rejects.toThrow("not-found");
    await expect(f.call(guest, "create-grant", { tripId: id, role: "editor" })).rejects.toThrow("not-found");
    await expect(f.call(guest, "participant", { tripId: id, participantId: g.grant.id, role: "editor", active: true, baseVersion: 0 })).rejects.toThrow("not-found");
    await expect(f.trips.execute(guest, { version: "trip-api-v1", operation: "archive", tripId: id })).rejects.toThrow("not-found");
    await expect(f.trips.execute(guest, { version: "trip-api-v1", operation: "get", tripId: id, ownerSubject: owner.subject })).rejects.toThrow("invalid-input");
  });
  it("expiration applies to membership, and archive denies existing members", async () => {
    const f = setup(), g = await f.grant(); await f.redeem(g);
    vi.spyOn(f.clock, "now").mockReturnValue(new Date("2026-10-01T00:00:00.000Z"));
    await expect(f.get()).rejects.toThrow("not-found"); await expect(f.redeem(g)).rejects.toThrow("not-found");
    const a = setup(), ag = await a.grant(); await a.redeem(ag); await a.repository.archive(owner, id);
    await expect(a.get()).rejects.toThrow("not-found"); await expect(a.redeem(ag)).rejects.toThrow("not-found");
  });
  it("owner role changes and explicit participant revocation use base version", async () => {
    const f = setup(), g = await f.grant(); await f.redeem(g);
    const m = (await f.repo.participant(guest, id))!;
    await f.call(owner, "participant", { tripId: id, participantId: m.id, role: "editor", active: true, baseVersion: m.version });
    expect((await f.get()).role).toBe("editor");
    await expect(f.call(owner, "participant", { tripId: id, participantId: m.id, role: "viewer", active: true, baseVersion: m.version })).rejects.toThrow("conflict");
    await f.call(owner, "participant", { tripId: id, participantId: m.id, role: "editor", active: false, baseVersion: m.version + 1 });
    await expect(f.get()).rejects.toThrow("not-found"); await expect(f.redeem(g)).rejects.toThrow("not-found");
  });
  it.each(["grant", "member"])("revoking %s immediately before commit atomically rejects editor mutation", async (kind) => {
    const f = setup(), g = await f.grant("editor"); await f.redeem(g);
    f.faults.beforeTransaction = () => {
      const k = kind === "grant" ? `GRANT#${g.grant.id}/GRANT#${g.grant.id}` : `PRINCIPAL#${guest.subject}/PARTICIPANT#${id}`;
      const row = f.records.get(k)!, payload = JSON.parse(row.payload!.S!);
      if (kind === "grant") { payload.revokedAt = f.clock.now().toISOString(); row.revoked = { BOOL: true }; }
      else payload.active = false;
      row.payload = { S: JSON.stringify(payload) };
    };
    await expect(f.mutate()).rejects.toThrow("conflict");
    expect((await f.repository.get(owner, id))?.revision).toBe(0);
    expect([...f.records.keys()].some((k) => k.includes("MUTATION#"))).toBe(false);
  });
  it("lost redemption and mutation responses retry without duplicate membership/Trip revision", async () => {
    const f = setup(), g = await f.grant("editor"); f.faults.lostResponse = true; await f.redeem(g); await f.redeem(g);
    const mutationId = f.crypto.id(); f.faults.lostResponse = true;
    expect((await f.mutate(guest, 0, mutationId)).revision).toBe(1);
    expect((await f.mutate(guest, 0, mutationId)).revision).toBe(1);
    expect([...f.records.keys()].filter((k) => k.includes("/PARTICIPANT#"))).toHaveLength(1);
  });
  it("stores only hashes; management, accessible Trips and facts expose no owner/secret/private resources", async () => {
    const f = setup(), g = await f.grant(); await f.redeem(g);
    expect(JSON.stringify([...f.records.values()])).not.toContain(g.secret);
    expect(f.crypto.verify(g.secret, (await f.repo.grant(g.grant.id))!.secretHash)).toBe(true);
    const manage = await f.call(owner, "manage", { tripId: id });
    const list = await f.call(guest, "accessible"); expect((list.trips as unknown[])).toHaveLength(1);
    expect(JSON.stringify([manage, list, await f.call(guest, "reservation-facts", { tripId: id })])).not.toMatch(/owner-A|guest-B|secretHash|bookingReference|principalSubject/);
    expect(JSON.stringify(manage)).not.toContain(g.secret);
    await expect(f.trips.execute(guest, { version: "trip-api-v1", operation: "attach", tripId: id, conversationId: "owner-conversation" })).rejects.toThrow("not-found");
    expect((await f.trips.execute(guest, { version: "trip-api-v1", operation: "list" })).trips).toEqual([]);
  });
  it("GSI is only a routing hint; removed/stale base rows cannot authorize or appear in management", async () => {
    const f = setup(), g = await f.grant(); await f.redeem(g);
    const original = f.client.send.bind(f.client);
    vi.spyOn(f.client, "send").mockImplementation(async (c) => {
      const result = await original(c);
      if (c instanceof QueryCommand && c.input.IndexName === "trip-sharing") f.records.delete(`PRINCIPAL#${guest.subject}/PARTICIPANT#${id}`);
      return result;
    });
    expect((await f.call(owner, "manage", { tripId: id })).participants).toEqual([]);
    await expect(f.get()).rejects.toThrow("not-found");
    expect(f.commands.filter((c) => c instanceof QueryCommand).every((c) => c.input.Limit! <= 20)).toBe(true);
    expect(f.commands.some((c) => c instanceof GetItemCommand && c.input.ConsistentRead && c.input.Key?.pk?.S?.startsWith("PRINCIPAL#"))).toBe(true);
    expect(f.commands.some((c) => c instanceof TransactWriteItemsCommand)).toBe(true);
  });
  it("rate bounds attempts; raw request/errors never appear in HTTP logs; gate stays closed", async () => {
    const f = setup(), g = await f.grant(), log = vi.fn();
    const handler = createTripSharingHandler(f.sharing, { authenticate: async () => guest, log });
    const event = { requestContext: { http: { method: "POST" } }, body: JSON.stringify({ version: "trip-sharing-v1", operation: "redeem", tripId: id, grantId: g.grant.id, secret: f.crypto.issue().secret }) };
    expect((await handler(event)).statusCode).toBe(404);
    expect((await handler({ ...event, rawQueryString: "ownerSubject=owner-A" })).statusCode).toBe(400);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|guest-B|GRANT/);
    expect((await createTripSharingHandler()(event)).statusCode).toBe(501);
    expect((await createTripSharingHandler(f.sharing, { authenticate: async () => undefined })(event)).statusCode).toBe(401);
    for (let n = 1; n < 30; n++) await f.repo.consume(guest);
    await expect(f.repo.consume(guest)).rejects.toThrow("unavailable");
  });
  it("editor cannot bypass fixed in-trip and booked Reservation confirmations", async () => {
    const f = setup(), trip: Trip = { ...createTrip(id, "旅行", "2026-09-13T00:00:00.000Z", [
      { id: "activity", type: "activity", title: "固定予約", category: "experience", schedule: {
        type: "fixed", startAt: { at: "2026-09-14T14:00:00+09:00", timeZone: "Asia/Tokyo" } } },
      { id: "later", type: "activity", title: "別の予定", category: "free-time", schedule: { type: "unscheduled" } },
    ]), lifecycleState: "in_trip" }; f.seed(trip);
    const facts: ReservationFact[] = [{ reservationId: other, itineraryItemId: "activity", kind: "activity", status: "booked", revision: 0 }];
    const reader = { facts: vi.fn(async (_principal: typeof owner) => facts) };
    const app = new TripApplication(f.repository, f.repository, f.clock, reader, undefined, f.sharing);
    const g = await f.grant("editor"); await f.redeem(g);
    const p = { tripId: id, baseRevision: 0, summary: "予約予定の削除案", patches: [{ type: "remove" as const, itemId: "activity" }] };
    const command = { version: "trip-api-v1", operation: "mutate", tripId: id, baseRevision: 0, mutationId: f.crypto.id(), proposal: p };
    await expect(app.execute(guest, command)).rejects.toThrow("invalid-input");
    const replanTargets = { tripId: id, baseRevision: 0, itemIds: ["activity"] };
    await expect(app.execute(guest, command, { replanTargets })).rejects.toThrow("confirmation-required");
    const confirmedReplan = previewInTripReplan(trip, p, { now: f.clock.now(), reservations: facts, targets: replanTargets }).confirmationKey;
    await expect(app.execute(guest, command, { replanTargets, confirmedReplan })).rejects.toThrow("confirmation-required");
    expect(await app.execute(guest, command, { replanTargets, confirmedReplan, confirmedReservationChange: reservationChangeKey(p, facts) })).toMatchObject({ revision: 1 });
    expect(reader.facts.mock.calls.every(([principal]) => principal.subject === owner.subject)).toBe(true);
    expect(facts[0]!.status).toBe("booked");
  });
  it("bounded participant pages, archive filtering, no Scan or backfill", async () => {
    const f = setup();
    expect(f.records.size).toBe(1);
    for (let n = 1; n <= 21; n++) {
      const tripId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const trip = createTrip(tripId, "旅", "2026-09-13T00:00:00.000Z"); f.seed(trip);
      const issued = f.crypto.issue(), g = { id: f.crypto.id(), tripId, ownerSubject: owner.subject, role: "viewer" as const, version: 0,
        secretHash: issued.hash, createdAt: f.clock.now().toISOString(), expiresAt: "2026-09-20T00:00:00.000Z" };
      await f.repo.createGrant(g, trip);
      await f.repo.putParticipant({ id: f.crypto.id(), tripId, ownerSubject: owner.subject, principalSubject: guest.subject,
        grantId: g.id, role: "viewer", version: 0, active: true, joinedAt: g.createdAt, updatedAt: g.createdAt }, undefined, g, trip);
    }
    const first = await f.call(guest, "accessible"); expect(first.trips).toHaveLength(20); expect(first.afterTripId).toBeTruthy();
    const second = await f.call(guest, "accessible", { afterTripId: first.afterTripId }); expect(second.trips).toHaveLength(1);
    expect(f.commands.some((c) => (c as object).constructor.name === "ScanCommand")).toBe(false);
  });
});
