import { describe, expect, it } from "vitest";
import { createTrip, type Trip, type TripUpdateProposal } from "@raiquora/trip/trip";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { TripApplication } from "../usecases/trip-application.js";
import { previewInTripReplan } from "../../../../frontend/src/usecases/trip-plan/in-trip-replan.js";

const owner = { subject: "owner-A" }, id = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-13T01:00:00Z");
const trip: Trip = { ...createTrip(id, "旅行", "2026-09-12T00:00:00Z", [
  { id: "past", type: "activity", title: "前の予定", category: "free-time", schedule: { type: "day", date: "2026-09-12", timeZone: "Asia/Tokyo" } },
  { id: "next", type: "activity", title: "次の予定", category: "free-time", schedule: { type: "day", date: "2026-09-13", timeZone: "Asia/Tokyo" } },
  { id: "fixed", type: "activity", title: "固定の予定", category: "free-time", schedule: { type: "fixed", startAt: { at: "2026-09-13T12:00:00+09:00", timeZone: "Asia/Tokyo" } } },
]), lifecycleState: "in_trip" };
const proposal = (itemId: string): TripUpdateProposal => ({ tripId: id, baseRevision: 0, summary: "削除案", patches: [{ type: "remove", itemId }] });
const command = (p: TripUpdateProposal, mutationId = "22222222-2222-4222-8222-222222222222") => ({ version: "trip-api-v1", operation: "mutate", tripId: id, baseRevision: p.baseRevision, mutationId, proposal: p });
const setup = () => { const f = tripDynamoFixture(); f.seed(trip); return { ...f,
  app: new TripApplication(f.repository, f.repository, { now: () => now }, { facts: async () => [] }) }; };
describe("in-trip guard before existing CAS", () => {
  it("rejects past mutation even with explicit host targeting and forged body authority", async () => {
    const f = setup(), p = proposal("past");
    await expect(f.app.execute(owner, command(p), { replanTargets: { tripId: id, baseRevision: 0, itemIds: ["past"] } })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.app.execute(owner, { ...command(p), replanTargets: { itemIds: ["past"] } })).rejects.toMatchObject({ code: "invalid-input" });
    expect(await f.repository.get(owner, id)).toEqual(trip);
  });
  it("requires separate explicit fixed confirmation, then preserves response-lost/idempotent retry", async () => {
    const f = setup(), p = proposal("fixed"), replanTargets = { tripId: id, baseRevision: 0, itemIds: ["fixed"] };
    await expect(f.app.execute(owner, command(p))).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.app.execute(owner, command(p), { replanTargets })).rejects.toMatchObject({ code: "confirmation-required" });
    const confirmedReplan = previewInTripReplan(trip, p, { now, reservations: [], targets: replanTargets }).confirmationKey;
    f.faults.lostResponse = true;
    const result = await f.app.execute(owner, command(p), { replanTargets, confirmedReplan });
    expect(result).toMatchObject({ revision: 1 });
    expect(await f.app.execute(owner, command(p))).toEqual(result); // receipt skips prepare, never rebase/reapply
    await expect(f.app.execute(owner, command(p, "33333333-3333-4333-8333-333333333333"), { replanTargets, confirmedReplan })).rejects.toMatchObject({ code: "conflict" });
    expect((await f.repository.get(owner, id))?.items.map((i) => i.id)).toEqual(["past", "next"]);
  });
  it("rejects missing Reservation reader and atomic mixed valid/invalid patch sequences", async () => {
    const f = setup(), p = proposal("next");
    const unavailable = new TripApplication(f.repository, f.repository, { now: () => now });
    await expect(unavailable.execute(owner, command(p))).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.app.execute(owner, command({ ...p, patches: [...p.patches, ...proposal("past").patches] }))).rejects.toMatchObject({ code: "invalid-input" });
    expect(await f.repository.get(owner, id)).toEqual(trip);
  });
});
