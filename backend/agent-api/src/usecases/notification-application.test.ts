import { describe, expect, it, vi } from "vitest";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { impactInput, impactNow } from "../../../../modules/trip/domain/rail-trip-impact.fixture.js";
import { evaluateRailTripImpact } from "@raiquora/trip/rail-trip-impact";
import { NotificationApplication, NotificationWorker } from "./notification-application.js";
import { notificationDynamoFixture } from "../adapters/notification-dynamodb.fixture.js";
import { notificationHash } from "../adapters/notification-record.js";
import type { NotificationDelivery } from "../ports/notification.js";

const p = { subject: "owner-A" };
async function setup(channel?: NotificationDelivery) {
  const f = notificationDynamoFixture(), input = impactInput(6); f.setNow(impactNow); f.seed(input.trip);
  const metric = vi.fn(), worker = new NotificationWorker(f.notifications, f.repository, f.impacts, channel ?? f.channel, notificationHash, { record: metric }, f.clock);
  const app = new NotificationApplication(f.notifications, f.repository, f.clock);
  async function save(delay = 6, seconds = 0) {
    const i = impactInput(delay), at = new Date(Date.parse(impactNow) + seconds * 1000).toISOString(); f.setNow(at);
    i.event = { ...i.event, observedAt: at, sources: i.event.sources.map((s) => ({ ...s, retrievedAt: at })) }; i.evaluatedAt = at;
    const impact = evaluateRailTripImpact(i); await f.impacts.save(p, i.trip, impact, i.event); return impact;
  }
  await save(); return { ...f, input, worker, app, metric, save };
}
describe("durable Notification pipeline", () => {
  it("Impact + signal commit atomically; decision + notification + delivery commit atomically", async () => {
    const f = await setup(); expect(f.rows.size).toBe(1);
    const tx = f.commands.find((c) => c instanceof TransactWriteItemsCommand) as TransactWriteItemsCommand;
    expect(tx.input.TransactItems).toHaveLength(3);
    expect(Object.keys(tx.input.TransactItems![1]!.Put!.Item!)).not.toContain("sent");
    await f.worker.poll(); expect((await f.app.list(p)).notifications[0]?.status).toBe("pending");
    await f.worker.poll(); expect((await f.app.list(p)).notifications[0]).toMatchObject({ status: "sent", currency: "current" });
    expect([...f.rows.values()].filter((r) => r.sk?.S?.startsWith("INBOX#"))).toHaveLength(1);
  });
  it("same Impact, Event recheck, concurrent worker and decision response lost create one notification", async () => {
    const f = await setup(); f.faults.lostResponse = true;
    await expect(f.worker.poll()).rejects.toThrow(); // Commit won; lost ACK cannot undo it.
    await f.save(6, 10); await Promise.all([f.worker.poll(), f.worker.poll()]); await f.worker.poll();
    expect((await f.app.list(p)).notifications).toHaveLength(1);
    expect(f.metric).toHaveBeenCalledWith("Suppress", 1);
  });
  it("A -> B -> A retains high-water mark; resolved -> later A starts new episode", async () => {
    const f = await setup(); await f.worker.poll(); await f.save(12, 10); await f.worker.poll(); await f.save(6, 20); await f.worker.poll();
    expect((await f.app.list(p)).notifications).toHaveLength(2);
    await f.save(0, 30); await f.worker.poll(); await f.save(6, 40); await f.worker.poll();
    expect((await f.app.list(p)).notifications).toHaveLength(4);
  });
  it("old observation cannot roll back current pointer or overwrite an Impact atomically", async () => {
    const f = await setup(); await f.save(12, 30); const before = structuredClone([...f.rows]);
    await expect(f.save(6, 0)).rejects.toMatchObject({ code: "conflict" }); expect([...f.rows]).toEqual(before);
  });
  it.each(["revision", "cancelled", "completed", "archived"])("%s Trip change stops delivery and marks history", async (change) => {
    const f = await setup(); await f.worker.poll();
    if (change === "archived") f.records.get(`OWNER#owner-A/TRIP#${f.input.trip.id}`)!.archived = { BOOL: true };
    else f.seed({ ...f.input.trip, revision: 1, ...(change !== "revision" ? { lifecycleState: change as "cancelled" | "completed" } : {}) });
    await f.worker.poll(); expect((await f.app.list(p)).notifications[0]).toMatchObject({ status: "suppressed", currency: "historical" });
  });
  it("Trip CAS races reject decision; in-app receipt is fenced against update after precheck", async () => {
    const f = await setup(); f.faults.beforeTransaction = () => f.seed({ ...f.input.trip, revision: 1 }); await f.worker.poll();
    expect((await f.app.list(p)).notifications).toHaveLength(0);
    const g = await setup(); await g.worker.poll(); g.faults.beforeTransaction = () => g.seed({ ...g.input.trip, revision: 1 }); await g.worker.poll();
    expect([...g.rows.values()].filter((r) => r.sk?.S?.startsWith("INBOX#"))).toHaveLength(0);
  });
  it("delivery response lost retries the same durable receipt, no permissions/subscription", async () => {
    const f = await setup(); await f.worker.poll(); f.faults.lostResponse = true; await f.worker.poll();
    f.setNow(Date.parse(impactNow) + 31000); await f.worker.poll();
    expect([...f.rows.values()].filter((r) => r.sk?.S?.startsWith("INBOX#"))).toHaveLength(1);
    expect((await f.app.list(p)).notifications[0]?.status).toBe("sent");
  });
  it("crashed claim recovers by lease; bounded retries dead-letter and operator redrive retains identity", async () => {
    const f = await setup({ send: async () => { throw new Error("private provider"); } }); await f.worker.poll();
    const due = await f.notifications.due(f.clock.now().getTime()); const claimed = await f.notifications.claim(due[0]!, f.clock.now().getTime()); expect(claimed).toBeDefined();
    f.setNow(Date.parse(impactNow) + 240001); await f.worker.poll();
    const row = f.rows.get(`${claimed!.key.pk}/${claimed!.key.sk}`)!;
    expect(Number(row.attempts?.N)).toBe(2);
    // Exhaustion is independent of provider/freshness; a poison/repeated-crash task is isolated.
    row.attempts = { N: "8" }; row.availableAt = { N: String(f.clock.now().getTime()) };
    await f.worker.poll(); expect((await f.app.list(p)).notifications[0]?.status).toBe("failed");
    const dead = f.rows.get(`${claimed!.key.pk}/${claimed!.key.sk}`)!; expect(dead.workState?.S).toBe("dead");
    await f.notifications.redrive(claimed!.key, Number(dead.workVersion?.N), f.clock.now().getTime());
    expect(f.rows.get(`${claimed!.key.pk}/${claimed!.key.sk}`)?.attempts?.N).toBe("0");
    await expect(f.notifications.redrive(claimed!.key, Number(dead.workVersion?.N), f.clock.now().getTime())).rejects.toMatchObject({ code: "conflict" });
  });
  it("poison payload is isolated; logs are numeric metric-only", async () => {
    const f = await setup(); const row = [...f.rows.values()][0]!; row.observation = { S: '{"private":"secret"}' };
    await f.worker.poll(); expect([...f.rows.values()][0]?.workState?.S).toBe("dead"); expect(JSON.stringify([...f.rows])).not.toContain("secret");
    expect(f.metric).toHaveBeenCalledWith("DLQ", 1); expect(f.metric.mock.calls.every(([name, value]) => typeof name === "string" && typeof value === "number")).toBe(true);
  });
  it("owner-scoped list/read, lost read ACK and historical navigation DTO omit private identifiers", async () => {
    const f = await setup(); await f.worker.poll(); await f.worker.poll(); const n = (await f.app.list(p)).notifications[0]!;
    expect((await f.app.list({ subject: "other" })).notifications).toEqual([]);
    await expect(f.app.read({ subject: "other" }, n.id, n.version)).rejects.toMatchObject({ code: "not-found" });
    await f.app.read(p, n.id, n.version); await f.app.read(p, n.id, n.version);
    expect((await f.app.list(p)).notifications[0]?.status).toBe("read");
    expect(n.tripId).toBe(f.input.trip.id); expect(n).not.toHaveProperty("subjectKey"); expect(n).not.toHaveProperty("impactId");
  });
  it("disabled delivery does not roll back monitoring or request permission", async () => {
    const f = await setup({ send: async () => "disabled" }); await f.worker.poll(); await f.worker.poll();
    expect((await f.app.list(p)).notifications[0]?.status).toBe("suppressed"); expect(f.records.size).toBeGreaterThan(1);
  });
  it("channel timeout/failure retains committed Notification and applies retry backoff", async () => {
    const f = await setup({ send: async () => { throw Object.assign(new Error("private-endpoint"), { name: "TimeoutError" }); } });
    await f.worker.poll(); await f.worker.poll();
    const job = [...f.rows.values()].find((r) => r.sk?.S?.startsWith("DELIVER#"))!;
    expect(job.workState?.S).toBe("pending"); expect(Number(job.availableAt?.N)).toBe(Date.parse(impactNow) + 30000);
    expect((await f.app.list(p)).notifications[0]?.status).toBe("pending"); expect(f.metric).toHaveBeenCalledWith("Retry", 1);
    expect(JSON.stringify([...f.rows])).not.toContain("private-endpoint");
  });
  it("new revision starts an independent episode; affected item removed before decision is not notified", async () => {
    const f = await setup(); await f.worker.poll();
    const i = impactInput(6); i.trip = { ...i.trip, revision: 1 }; i.watches = i.watches.map((w) => ({ ...w, sourceTripRevision: 1 })); f.seed(i.trip);
    const impact = evaluateRailTripImpact(i); await f.impacts.save(p, i.trip, impact, i.event); await f.worker.poll();
    const list = await f.app.list(p); expect(list.notifications).toHaveLength(2); expect(list.notifications.some((n) => n.tripRevision === 0 && n.currency === "historical")).toBe(true);
    const g = await setup(); g.seed({ ...g.input.trip, revision: 1, items: [] }); await g.worker.poll(); expect((await g.app.list(p)).notifications).toHaveLength(0);
  });
});
