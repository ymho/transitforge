import { describe, expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { TripApplication } from "./trip-application.js";

const owner = { subject: "owner-A" }, other = { subject: "owner-B" };
function setup() {
  const f = tripDynamoFixture();
  const trip = createTrip("75600000-0000-4000-8000-000000000001", "出雲", "2026-09-14T01:00:00.000Z", [
    { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01" }, place: { name: "出雲大社", sources: [] } },
    { id: "hotel", title: "宿未定", type: "stay", schedule: { type: "unscheduled" }, selection: { status: "unselected" } },
  ]);
  f.seed(trip); return { ...f, trip, app: new TripApplication(f.repository, f.repository, f.clock) };
}
describe("authenticated item decisions", () => {
  const target = { operation: "preview" as const, tripId: "75600000-0000-4000-8000-000000000001", itemId: "shrine",
    baseTripRevision: 0, mutationId: "75600000-0000-4000-8000-000000000010", action: "confirm" as const };
  it("requires matching preview authority, isolates owners, survives replay, and preserves other items", async () => {
    const f = setup();
    await expect(f.app.executeItemDecision(other, target)).rejects.toMatchObject({ code: "not-found" });
    const preview = await f.app.executeItemDecision(owner, target);
    if (preview.status !== "confirmation-required") throw new Error("Preview required");
    expect(preview.preview).toMatchObject({ itemId: "shrine", action: "confirm" });
    await expect(f.app.executeItemDecision(owner, { ...target, operation: "confirm" })).rejects.toMatchObject({ code: "confirmation-required" });
    await expect(f.app.executeItemDecision(owner, { ...target, operation: "confirm", mutationId: "75600000-0000-4000-8000-000000000011" },
      { confirmationKey: preview.confirmationKey })).rejects.toMatchObject({ code: "confirmation-required" });
    const saved = await f.app.executeItemDecision(owner, { ...target, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
    expect(saved).toMatchObject({ status: "saved", trip: { revision: 1, items: [{ decision: { confirmedAt: f.clock.now().toISOString() } }, {}] } });
    expect(await f.app.executeItemDecision(owner, { ...target, operation: "confirm" }, { confirmationKey: preview.confirmationKey })).toEqual(saved);
    await expect(f.app.executeItemDecision(owner, target)).rejects.toMatchObject({ code: "conflict" });
    const withdrawal = { ...target, operation: "preview" as const, action: "withdraw" as const, baseTripRevision: 1,
      mutationId: "75600000-0000-4000-8000-000000000012" };
    const withdraw = await f.app.executeItemDecision(owner, withdrawal);
    if (withdraw.status !== "confirmation-required") throw new Error("Preview required");
    const draft = await f.app.executeItemDecision(owner, { ...withdrawal, operation: "confirm" }, { confirmationKey: withdraw.confirmationKey });
    expect((draft as unknown as { trip: typeof f.trip }).trip.items[0]).not.toHaveProperty("decision");
  });
  it("rejects unspecified items and forged create decisions", async () => {
    const f = setup();
    await expect(f.app.executeItemDecision(owner, { ...target, itemId: "hotel" })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.app.execute(owner, { version: "trip-api-v1", operation: "create", trip: { ...f.trip,
      id: "75600000-0000-4000-8000-000000000099", items: [{ ...f.trip.items[0], decision: { confirmedAt: "2026-09-14T01:00:00Z" } }] } })).rejects.toMatchObject({ code: "confirmation-required" });
  });
});
