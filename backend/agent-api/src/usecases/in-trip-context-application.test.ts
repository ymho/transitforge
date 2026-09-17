import { describe, expect, it, vi } from "vitest";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture.js";
import { impactInput } from "../../../../modules/trip/domain/rail-trip-impact.fixture.js";
import { notificationDynamoFixture } from "../adapters/notification-dynamodb.fixture.js";
import { NotificationApplication, NotificationWorker } from "./notification-application.js";
import { notificationHash, signalKey } from "../adapters/notification-record.js";
import { InTripContextApplication } from "./in-trip-context-application.js";
import { validateInTripContext } from "@raiquora/trip/in-trip-context";

const p = { subject: "owner-A" };
async function setup() {
  const f = notificationDynamoFixture(), domain = inTripFixture();
  f.setNow(domain.now.at); f.seed(domain.trip, p.subject, true);
  await f.impacts.save(p, domain.trip, domain.impact, impactInput(6).event);
  const reservations = { facts: vi.fn(async () => []) };
  const notifications = new NotificationApplication(f.notifications, f.repository, f.clock);
  const app = new InTripContextApplication(f.repository, f.notifications, f.impacts, reservations, notifications, f.clock);
  const worker = new NotificationWorker(f.notifications, f.repository, f.impacts, f.channel, notificationHash, { record() {} }, f.clock);
  return { ...f, ...domain, reservations, notificationsApp: notifications, app, worker };
}
describe("owner-scoped in-trip reads", () => {
  it("reads current Impact before any notification exists via bounded consistent Query", async () => {
    const f = await setup(), before = JSON.stringify([...f.records]);
    const s = await f.app.read(p, f.trip.id); validateInTripContext(s!);
    expect(s!.impacts.items).toHaveLength(1); expect(s!.notifications.items).toHaveLength(0);
    expect(s!.reservations.status).toBe("available");
    const queries = f.commands.filter((c) => c instanceof QueryCommand) as QueryCommand[];
    expect(queries.every((q) => q.input.Limit === 12 && q.input.ConsistentRead === true && !q.input.IndexName)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/owner-A|impactId|episodeId|bookingReference|providerAlertId/);
    expect(JSON.stringify([...f.records])).toBe(before);
  });
  it("uses existing currency for current notification and removes internal IDs", async () => {
    const f = await setup(); await f.worker.poll(); await f.worker.poll();
    const s = await f.app.read(p, f.trip.id); expect(s!.notifications.items[0]).toMatchObject({ currency: "current", status: "sent" });
    expect(JSON.stringify(s!.notifications)).not.toMatch(/dedupeKey|episodeId|impactId|subjectKey|"id"/);
  });
  it("stale observation is unknown, not current safety; notification unconfirmed stays unconfirmed", async () => {
    const f = await setup(); await f.worker.poll(); f.setNow("2026-09-13T01:10:00Z");
    const s = await f.app.read(p, f.trip.id);
    expect(s!.impacts.status).toBe("unknown"); expect(s!.impacts.items).toHaveLength(0);
    expect(s!.notifications.items[0]!.currency).toBe("unconfirmed");
  });
  it("reservation reader failure is unavailable, not empty success", async () => {
    const f = await setup(); f.reservations.facts.mockRejectedValue(new Error("PRIVATE provider failure"));
    const s = await f.app.read(p, f.trip.id); expect(s!.reservations).toMatchObject({ status: "unavailable", items: [] });
    expect(JSON.stringify(s)).not.toContain("PRIVATE");
  });
  it("rejects other owner, missing principal and concurrent edits, including old envelope", async () => {
    const f = await setup(); await expect(f.app.read({ subject: "other" }, f.trip.id)).rejects.toThrow();
    await expect(f.app.read({ subject: "" }, f.trip.id)).rejects.toThrow();
    f.reservations.facts.mockImplementation(async () => { f.seed({ ...f.trip, title: "changed" }, p.subject, true); return []; });
    await expect(f.app.read(p, f.trip.id)).rejects.toThrow();
  });
  it("excludes previous revision and never starts reads for terminal/pre-trip", async () => {
    const f = await setup(); f.seed({ ...f.trip, revision: f.trip.revision + 1 }, p.subject);
    expect((await f.app.read(p, f.trip.id))!.impacts.items).toHaveLength(0);
    for (const lifecycleState of ["pre_trip", "cancelled", "completed"] as const) {
      f.seed({ ...f.trip, lifecycleState }, p.subject); f.reservations.facts.mockClear();
      expect(await f.app.read(p, f.trip.id)).toBeUndefined(); expect(f.reservations.facts).not.toHaveBeenCalled();
    }
  });
  it("missing Impact after a valid pointer cannot be treated as no-impact", async () => {
    const f = await setup();
    const app = new InTripContextApplication(f.repository, f.notifications, { read: async () => undefined }, f.reservations, new NotificationApplication(f.notifications, f.repository, f.clock), f.clock);
    expect((await app.read(p, f.trip.id))!.impacts.status).toBe("unavailable");
  });
  it("bounded pointer read exposes truncation and rejects malformed storage metadata", async () => {
    const f = await setup(), row = [...f.rows.values()][0]!;
    for (let index = 0; index < 14; index++) {
      const o = { ...JSON.parse(row.observation!.S!), subjectKey: `scope-${index}` }, sk = signalKey(f.trip.id, o.subjectKey);
      f.rows.set(`OWNER#owner-A/${sk}`, { ...row, sk: { S: sk }, observation: { S: JSON.stringify(o) } });
    }
    const read = await f.notifications.observations(p, f.trip.id);
    expect(read.observations).toHaveLength(12); expect(read.truncated).toBe(true);
    const s = await f.app.read(p, f.trip.id); expect(s!.impacts.truncated).toBe(true);
    expect(s!.truncation.truncated).toBe(true);
    for (const r of f.rows.values()) r.storageVersion = { N: "999" };
    expect((await f.app.read(p, f.trip.id))!.impacts.status).toBe("unavailable");
  });
  it("a newer observation during read invalidates both Impact and notification views", async () => {
    const f = await setup(); let reads = 0;
    const observations = { observations: async () => {
      const page = await f.notifications.observations(p, f.trip.id);
      if (++reads > 1) page.observations[0] = { ...page.observations[0]!, observedAt: "2026-09-13T01:00:01Z", evaluatedAt: "2026-09-13T01:00:01Z" };
      return page;
    } };
    const app = new InTripContextApplication(f.repository, observations, f.impacts, f.reservations, f.notificationsApp, f.clock);
    const s = await app.read(p, f.trip.id);
    expect(s!.impacts.status).toBe("unavailable"); expect(s!.notifications.status).toBe("unavailable");
  });
});
