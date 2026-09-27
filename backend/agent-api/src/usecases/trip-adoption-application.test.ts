import { describe, expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { TripApplication } from "./trip-application.js";

const owner = { subject: "owner-A" }, other = { subject: "owner-B" };
const mutationId = "75400000-0000-4000-8000-000000000010";
function setup() {
  const f = tripDynamoFixture();
  const trip = createTrip("75400000-0000-4000-8000-000000000001", "出雲の旅", "2026-09-14T01:00:00.000Z", [
    { id: "visit", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-09-20", timeZone: "Asia/Tokyo" } },
  ]);
  f.seed(trip); return { ...f, trip, app: new TripApplication(f.repository, f.repository, f.clock) };
}

describe("explicit Trip adoption application", () => {
  it("previews an exact user decision, confirms it once, and replays the same mutation", async () => {
    const f = setup(), request = { operation: "preview" as const, tripId: f.trip.id, baseTripRevision: 0, mutationId, action: "confirm" as const };
    const preview = await f.app.executeTripAdoption(owner, request);
    expect(preview).toMatchObject({ status: "confirmation-required", preview: { action: "confirm", needsReconfirmation: false } });
    if (preview.status !== "confirmation-required") throw new Error("preview expected");
    await expect(f.app.executeTripAdoption(owner, { ...request, operation: "confirm" })).rejects.toMatchObject({ code: "confirmation-required" });
    await expect(f.app.executeTripAdoption(owner, { ...request, operation: "confirm", mutationId: "75400000-0000-4000-8000-000000000012" },
      { confirmationKey: preview.confirmationKey })).rejects.toMatchObject({ code: "confirmation-required" });
    const saved = await f.app.executeTripAdoption(owner, { ...request, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
    expect(saved).toMatchObject({ status: "saved", trip: { revision: 1, adoption: { confirmedAt: f.clock.now().toISOString() } } });
    expect(await f.app.executeTripAdoption(owner, { ...request, operation: "confirm" }, { confirmationKey: preview.confirmationKey })).toEqual(saved);
  });
  it("withdraws only by explicit confirmation and isolates owners/stale previews", async () => {
    const f = setup(), request = { operation: "preview" as const, tripId: f.trip.id, baseTripRevision: 0, mutationId, action: "confirm" as const };
    await expect(f.app.executeTripAdoption(other, request)).rejects.toMatchObject({ code: "not-found" });
    const preview = await f.app.executeTripAdoption(owner, request);
    if (preview.status !== "confirmation-required") throw new Error("preview expected");
    await f.app.executeTripAdoption(owner, { ...request, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
    await expect(f.app.executeTripAdoption(owner, request)).rejects.toMatchObject({ code: "conflict" });
    const withdrawal = { operation: "preview" as const, tripId: f.trip.id, baseTripRevision: 1,
      mutationId: "75400000-0000-4000-8000-000000000011", action: "withdraw" as const };
    const withdrawPreview = await f.app.executeTripAdoption(owner, withdrawal);
    if (withdrawPreview.status !== "confirmation-required") throw new Error("preview expected");
    const result = await f.app.executeTripAdoption(owner, { ...withdrawal, operation: "confirm" }, { confirmationKey: withdrawPreview.confirmationKey });
    if (result.status !== "saved") throw new Error("save expected");
    expect((result as unknown as { trip: { adoption?: unknown } }).trip.adoption).toBeUndefined();
  });
});
