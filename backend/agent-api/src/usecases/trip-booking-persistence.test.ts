import { expect, it } from "vitest";
import { TripApplication } from "./trip-application.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { createTrip } from "@raiquora/trip/trip";
it("persists booking marks with owner scope, CAS and idempotent mutation receipts", async () => {
 const f = tripDynamoFixture(), owner = { subject: "owner-A" };
 const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-13T00:00:00Z",
  [{ id: "hotel", type: "stay", title: "宿", selection: { status: "unselected" }, schedule: { type: "day", date: "2026-09-16", timeZone: "Asia/Tokyo" } }]);
 f.seed(trip, owner.subject); const app = new TripApplication(f.repository, f.repository, f.clock);
 const command = { version: "trip-api-v1", operation: "mutate", tripId: trip.id, baseRevision: 0,
  mutationId: "22222222-2222-4222-8222-222222222222", proposal: { tripId: trip.id, baseRevision: 0, summary: "予約済",
  patches: [{ type: "item_booking", itemId: "hotel", status: "booked" }] } };
 const saved = await app.execute(owner, command);
 expect(saved).toMatchObject({ trip: { revision: 1, items: [{ bookingStatus: "booked" }] } });
 expect(await app.execute(owner, command)).toEqual(saved);
 await expect(app.execute(owner, { ...command, mutationId: "33333333-3333-4333-8333-333333333333" })).rejects.toMatchObject({ code: "conflict" });
 await expect(app.execute({ subject: "other" }, command)).rejects.toMatchObject({ code: "not-found" });
});
