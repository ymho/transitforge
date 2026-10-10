import { describe, expect, it } from "vitest";
import { createTrip, type Trip } from "@raiquora/trip/trip";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { DynamoDbOfficialGuide } from "../adapters/dynamodb-official-guide.js";
import { OfficialGuideApplication } from "./official-guide-application.js";
const id = "11111111-1111-4111-8111-111111111111", copyId = "22222222-2222-4222-8222-222222222222";
const owner = { subject: "official" }, guest = { subject: "guest" }, second = { subject: "second-official" };
function setup() {
  const f = tripDynamoFixture(), guideRepo = new DynamoDbOfficialGuide("test-trips", f.client);
  const source = createTrip(id, "公式旅", f.clock.now().toISOString(), [{ id: "a", type: "activity", title: "海", category: "sightseeing", schedule: { type: "day", date: "2026-12-20", timeZone: "Asia/Tokyo" } }]);
  f.seed(source, owner.subject);
  const app = new OfficialGuideApplication(f.repository, guideRepo, [owner.subject, second.subject], () => f.clock.now().toISOString());
  const call = (principal: typeof owner, operation: string, fields: object = {}) => app.execute(principal, { version: "trip-sharing-v1", operation: `official-${operation}`, ...fields });
  const publish = () => call(owner, "publish", { tripId: id, baseRevision: 0 });
  const copy = (extra: object = {}) => call(guest, "import", { tripId: id, guideVersion: 1, newTripId: copyId, startDate: "2026-12-31", adults: 2, children: 0, ...extra });
  return { ...f, guideRepo, app, call, publish, copy };
}
describe("authenticated official catalogue and atomic import", () => {
  it("allows only configured publishers' owned Trips; never trusts the request for privilege", async () => {
    const f = setup();
    await expect(f.call(guest, "capabilities")).resolves.toMatchObject({ publisher: false });
    await expect(f.call(owner, "capabilities")).resolves.toMatchObject({ publisher: true });
    await expect(f.call(guest, "publish", { tripId: id, baseRevision: 0 })).rejects.toThrow("not-found");
    await expect(f.call(second, "publish", { tripId: id, baseRevision: 0 })).rejects.toThrow("not-found");
    await expect(f.call(guest, "publish", { tripId: id, baseRevision: 0, publisher: true })).rejects.toThrow("invalid-input");
    await f.publish(); expect(JSON.stringify(await f.call(guest, "list"))).not.toContain('"publisher"');
    expect((await f.call(guest, "get", { tripId: id })).guide).toMatchObject({ version: 1 });
  });
  it("publication is frozen until republished; old version import conflicts, withdrawal denies reads", async () => {
    const f = setup(); await f.publish();
    f.seed({ ...(await f.repository.get(owner, id))!, title: "変更後" }, owner.subject);
    expect((await f.guideRepo.get(id))?.guide.trip.title).toBe("公式旅"); await f.publish();
    await expect(f.copy()).rejects.toThrow("conflict");
    await expect(f.call(guest, "withdraw", { tripId: id, guideVersion: 2 })).rejects.toThrow("not-found");
    await f.call(owner, "withdraw", { tripId: id, guideVersion: 2 });
    await expect(f.call(guest, "get", { tripId: id })).rejects.toThrow("not-found");
    expect((await f.call(guest, "list")).guides).toEqual([]);
  });
  it("lost import response retries once, emits one outbox event, rejects changed inputs and keeps independent Trip", async () => {
    const f = setup(); await f.publish(); f.faults.lostResponse = true;
    const first = await f.copy(), again = await f.copy(); expect(again.trip).toEqual(first.trip);
    expect((first.trip as Trip).officialOrigin).toEqual({ guideId: id, version: 1 });
    expect([...f.records.keys()].filter(k => k.startsWith("OWNER#guest/TRIP_CHANGED#"))).toHaveLength(1);
    await expect(f.copy({ adults: 3 })).rejects.toThrow("already-exists");
    expect((await f.repository.get(owner, id))?.items[0]?.schedule).toMatchObject({ date: "2026-12-20" });
  });
  it("withdrawal immediately before import commit atomically creates no Trip or outbox", async () => {
    const f = setup(); await f.publish(); f.faults.beforeTransaction = () => {
      const r = f.records.get(`OFFICIAL#CATALOG/GUIDE#${id}`)!, payload = JSON.parse(r.payload!.S!); payload.active = false; r.payload = { S: JSON.stringify(payload) };
    };
    await expect(f.copy()).rejects.toThrow("conflict"); expect(await f.repository.get(guest, copyId)).toBeUndefined();
    expect([...f.records.keys()].some(k => k.startsWith("OWNER#guest/"))).toBe(false);
  });
  it("removing a publisher from configuration hides existing publications", async () => {
    const f = setup(); await f.publish(); const app = new OfficialGuideApplication(f.repository, f.guideRepo, []);
    expect((await app.execute(guest, { version: "trip-sharing-v1", operation: "official-list" })).guides).toEqual([]);
    await expect(app.execute(guest, { version: "trip-sharing-v1", operation: "official-get", tripId: id })).rejects.toThrow("not-found");
  });
});
it("publication fences owner archive/source edits and preserves the prior version", async () => {
  const f = setup(); await f.publish(); f.faults.beforeTransaction = () => {
    const row = f.records.get(`OWNER#official/TRIP#${id}`)!; row.archived = { BOOL: true };
  };
  await expect(f.publish()).rejects.toThrow("conflict"); expect((await f.guideRepo.get(id))?.guide.version).toBe(1);
});
it("empty catalogue pages retain their cursor and the last page is reachable", async () => {
  const f = setup();
  for (let i = 1; i <= 21; i++) {
    const gid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const source = createTrip(gid, "旅", f.clock.now().toISOString());
    await f.repository.create(owner, source);
    await f.guideRepo.publish(owner, source, { publisher: "official", active: i === 21, guide: { id: gid, version: 1, publishedAt: source.createdAt, trip: source } });
  }
  const first = await f.guideRepo.list(); expect(first.guides).toEqual([]); expect(first.after).toBeDefined();
  const second = await f.guideRepo.list(first.after); expect(second.guides).toHaveLength(1); expect(second.after).toBeUndefined();
});
