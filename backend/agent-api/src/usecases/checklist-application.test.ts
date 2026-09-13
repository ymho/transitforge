import { it, expect } from "vitest";
import { ChecklistApplication } from "./checklist-application.js";
import { checklistDynamoFixture } from "../adapters/checklist-dynamodb.fixture.js";
import { requestTrip } from "../../../../modules/trip/domain/trip-request.fixture.js";
import { checklistItem } from "../../../../modules/trip/domain/trip-checklist.fixture.js";
import type { ChecklistCommand } from "@raiquora/trip/checklist-edit";

const owner = { subject: "owner-A" }, other = { subject: "owner-B" }, yes = { confirmed: true };
function fixture() {
  const db = checklistDynamoFixture(), trip = requestTrip(); db.seed(trip);
  let n = 0;
  const app = new ChecklistApplication(db.repository, db.checklist, { facts: async () => [] }, () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++n).padStart(12, "0")}`);
  const add: ChecklistCommand = { operation: "add", tripId: trip.id, id: checklistItem().id, details: { category: "connectivity", title: "SIM" } };
  return { ...db, app, trip, add };
}
it("requires trusted owner/confirmation, rejects body owner and missing/archived Trip, keeps isolated resources", async () => {
  const f = fixture();
  await expect(f.app.execute(undefined, f.add, yes)).rejects.toMatchObject({ code: "unauthenticated" });
  await expect(f.app.execute(owner, f.add)).rejects.toMatchObject({ code: "confirmation-required" });
  await expect(f.app.execute(owner, { ...f.add, ownerId: "owner-A" }, yes)).rejects.toMatchObject({ code: "invalid-input" });
  await expect(f.app.execute(other, f.add, yes)).rejects.toMatchObject({ code: "not-found" });
  await f.app.execute(owner, f.add, yes);
  expect(await f.checklist.read(other, f.trip.id)).toEqual({ items: [], version: 0 });
  await f.repository.archive(owner, f.trip.id);
  await expect(f.app.list(owner, f.trip.id)).rejects.toMatchObject({ code: "not-found" });
  expect((await f.checklist.read(owner, f.trip.id)).items).toHaveLength(1); // no cascade
});
it("CRUD, explicit unlink/archive, stale item CAS and independent Trip revision", async () => {
  const f = fixture(); await f.app.execute(owner, f.add, yes);
  let [item] = await f.app.list(owner, f.trip.id);
  for (const status of ["done", "open", "not-needed"] as const) {
    const r = await f.app.execute(owner, { operation: "update", tripId: f.trip.id, id: item!.id, baseRevision: item!.revision, changes: { status } }, yes); item = r.changed[0];
  }
  await expect(f.app.execute(owner, { operation: "update", tripId: f.trip.id, id: item!.id, baseRevision: 0, changes: { status: "open" } }, yes)).rejects.toMatchObject({ code: "conflict" });
  await f.app.execute(owner, { operation: "update", tripId: f.trip.id, id: item!.id, baseRevision: item!.revision, changes: { title: "eSIM", archived: true, relatedItineraryItemId: null, relatedReservationId: null } }, yes);
  expect((await f.app.list(owner, f.trip.id))[0]).toMatchObject({ revision: 4, title: "eSIM", archived: true, source: "user" });
  expect(await f.repository.get(owner, f.trip.id)).toEqual(f.trip);
});
it("repeated confirmed suggestions preserve user/done/not-needed/archive and never partially apply", async () => {
  const f = fixture(); await f.app.execute(owner, f.add, yes);
  await f.app.execute(owner, { operation: "update", tripId: f.trip.id, id: checklistItem().id, baseRevision: 0, changes: { status: "done" } }, yes);
  const proposal = { tripId: f.trip.id, suggestions: [{ category: "connectivity", title: " ＳＩＭ " }, { category: "packing", title: "傘" }] };
  const command = { operation: "confirm-suggestions", proposal };
  expect(await f.app.execute(owner, command, yes)).toMatchObject({ changed: [{ title: "傘", status: "open", source: "model" }], skipped: 1 });
  const before = await f.app.list(owner, f.trip.id);
  expect(await f.app.execute(owner, command, yes)).toEqual({ changed: [], skipped: 2 });
  expect(await f.app.list(owner, f.trip.id)).toEqual(before);
  await expect(f.app.execute(owner, { operation: "confirm-suggestions", proposal: { tripId: f.trip.id,
    suggestions: [{ category: "packing", title: "雨具" }, { category: "tickets", title: "予約確認", relatedReservationId: checklistItem().id }] } }, yes)).rejects.toMatchObject({ code: "invalid-input" });
  expect(await f.app.list(owner, f.trip.id)).toEqual(before);
});
it("serializes competing dedupe and rejects CAS without partial write; lost response retry dedupes", async () => {
  const f = fixture(); await f.app.execute(owner, f.add, yes);
  const initial = await f.checklist.read(owner, f.trip.id);
  const updated = { ...initial.items[0]!, status: "done" as const, revision: 1 };
  await f.checklist.commit(owner, f.trip.id, initial.version, [{ item: updated, baseRevision: 0 }]);
  await expect(f.checklist.commit(owner, f.trip.id, initial.version, [{ item: { ...updated, title: "x" }, baseRevision: 0 }])).rejects.toMatchObject({ code: "conflict" });
  expect((await f.app.list(owner, f.trip.id))[0]).toEqual(updated);
  const command = { operation: "confirm-suggestions", proposal: { tripId: f.trip.id, suggestions: [{ category: "packing", title: "傘" }] } };
  f.checklistFaults.lostResponse = true;
  await expect(f.app.execute(owner, command, yes)).rejects.toMatchObject({ code: "unavailable" });
  expect(await f.app.execute(owner, command, yes)).toMatchObject({ changed: [], skipped: 1 });
  expect(await f.app.list(owner, f.trip.id)).toHaveLength(2);
});
it("keeps dangling item relations on status edits and allows explicit unlink, rejecting new unknown links", async () => {
  const f = fixture(), linked = checklistItem({ tripId: f.trip.id, relatedItineraryItemId: "removed" });
  await f.checklist.commit(owner, f.trip.id, 0, [{ item: linked }]);
  await f.app.execute(owner, { operation: "update", tripId: f.trip.id, id: linked.id, baseRevision: 0, changes: { status: "done" } }, yes);
  expect((await f.app.list(owner, f.trip.id))[0]?.relatedItineraryItemId).toBe("removed");
  await expect(f.app.execute(owner, { operation: "update", tripId: f.trip.id, id: linked.id, baseRevision: 1, changes: { relatedItineraryItemId: "other-missing" } }, yes)).rejects.toMatchObject({ code: "invalid-input" });
  await f.app.execute(owner, { operation: "update", tripId: f.trip.id, id: linked.id, baseRevision: 1, changes: { relatedItineraryItemId: null } }, yes);
  expect((await f.app.list(owner, f.trip.id))[0]).not.toHaveProperty("relatedItineraryItemId");
});

it("concurrent exact-key suggestions cannot both add, including different generated IDs", async () => {
  const f = fixture(), command = { operation: "confirm-suggestions", proposal: { tripId: f.trip.id, suggestions: [{ category: "packing", title: "傘" }] } };
  const results = await Promise.allSettled([f.app.execute(owner, command, yes), f.app.execute(owner, command, yes)]);
  expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  expect(await f.app.list(owner, f.trip.id)).toHaveLength(1);
  for (const r of results) if (r.status === "rejected") expect(r.reason.code).toBe("conflict");
});

it("item CAS also rejects a stale revision when collection CAS is current", async () => {
  const f = fixture(); await f.app.execute(owner, f.add, yes);
  const first = await f.checklist.read(owner, f.trip.id), next = { ...first.items[0]!, revision: 1, status: "done" as const };
  await f.checklist.commit(owner, f.trip.id, first.version, [{ item: next, baseRevision: 0 }]);
  const current = await f.checklist.read(owner, f.trip.id);
  await expect(f.checklist.commit(owner, f.trip.id, current.version, [{ item: { ...next, title: "変更" }, baseRevision: 0 }])).rejects.toMatchObject({ code: "conflict" });
  expect(await f.checklist.read(owner, f.trip.id)).toEqual(current);
});
