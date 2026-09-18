import { expect, it } from "vitest";
import { createTrip, type Trip } from "@raiquora/trip/trip";
import { reservationChangeKey, type ReservationFact } from "@raiquora/trip/reservation";
import { createTripWorkspaceController } from "./trip-workspace-controller";

it("shares the pure replan policy for preview, reject and exact confirmation", async () => {
  const now = new Date("2026-09-20T01:00:00Z");
  const trip: Trip = { ...createTrip("11111111-1111-4111-8111-111111111111", "旅行", "2026-09-19T00:00:00Z", [
    { id: "kept", type: "activity", title: "残す予定", category: "free-time", schedule: { type: "unscheduled" } },
    { id: "booked", type: "activity", title: "予約済み", category: "free-time", schedule: { type: "fixed",
      startAt: { at: "2026-09-20T13:00:00+09:00", timeZone: "Asia/Tokyo" } } },
  ]), lifecycleState: "in_trip" };
  const facts: ReservationFact[] = [{ reservationId: "22222222-2222-4222-8222-222222222222", revision: 0,
    kind: "activity", status: "booked", itineraryItemId: "booked" }];
  const p = { tripId: trip.id, baseRevision: 0, summary: "変更案", patches: [{ type: "remove" as const, itemId: "booked" }] };
  let writes = 0;
  const c = createTripWorkspaceController("s", () => now);
  c.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => facts,
    getReplanTargets: () => ({ tripId: trip.id, baseRevision: 0, itemIds: ["booked"] }), confirmProposal: async () => { writes++; } });
  c.preview(p); await expect(c.confirm()).rejects.toThrow(); expect(writes).toBe(0);
  c.dismiss(); expect(writes).toBe(0); expect(trip.items).toHaveLength(2);
  c.preview(p);
  await c.confirm({ replanConfirmationKey: c.replan()!.confirmationKey, reservationChangeKey: reservationChangeKey(p, facts) });
  expect(writes).toBe(1);
  expect(() => c.preview({ tripId: trip.id, baseRevision: 0, summary: "条件確認",
    patches: [{ type: "request", request: trip.request }] })).not.toThrow();
  expect(c.replan()).toBeUndefined();
});
