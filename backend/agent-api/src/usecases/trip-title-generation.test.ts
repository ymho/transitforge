import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { TripApplication } from "./trip-application.js";
import { DynamoDbTripSharing } from "../adapters/dynamodb-trip-sharing.js";
import { CryptographicShareSecret } from "../adapters/share-secret.js";
import { TripSharingApplication } from "./trip-sharing-application.js";
const id = "11111111-1111-4111-8111-111111111111", owner = { subject: "owner-A" }, guest = { subject: "guest-B" };
function fixture() {
 const f = tripDynamoFixture(), trip = createTrip(id, "おいしいものを楽しみたい", "2026-09-13T00:00:00.000Z", [{ id: "visit", type: "activity", title: "出雲大社", category: "sightseeing", schedule: { type: "unscheduled" } }]);
 f.seed(trip, owner.subject);
 const repo = new DynamoDbTripSharing("test-trips", f.client, f.clock), crypto = new CryptographicShareSecret();
 const sharing = new TripSharingApplication(f.repository, repo, crypto, repo, f.clock, { facts: async () => [] });
 const generate = vi.fn(async () => "出雲大社を訪ねる旅");
 const app = new TripApplication(f.repository, f.repository, f.clock, { facts: async () => [] }, undefined, sharing, undefined, undefined, { generate });
 return { ...f, app, trip, sharing, generate, crypto };
}
it("generates from current items, rejects stale revisions, and never mutates during generation", async () => {
 const f = fixture();
 expect(await f.app.execute(owner, { version: "trip-api-v1", operation: "generate-title", tripId: id, baseRevision: 0 })).toMatchObject({ title: "出雲大社を訪ねる旅", baseRevision: 0 });
 expect(f.generate).toHaveBeenCalledWith([{ type: "activity", title: "出雲大社" }]);
 expect((await f.repository.get(owner, id))?.title).toBe(f.trip.title);
 await expect(f.app.execute(owner, { version: "trip-api-v1", operation: "generate-title", tripId: id, baseRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
 expect(f.generate).toHaveBeenCalledOnce();
});
it.each(["editor", "viewer"])("shared %s reads the same regenerated title; only editors can generate", async role => {
 const f = fixture();
 const grant = await f.sharing.execute(owner, { version: "trip-sharing-v1", operation: "create-grant", tripId: id, role }) as { grant: { id: string }; secret: string };
 await f.sharing.execute(guest, { version: "trip-sharing-v1", operation: "redeem", tripId: id, grantId: grant.grant.id, secret: grant.secret });
 const generate = f.app.execute(guest, { version: "trip-api-v1", operation: "generate-title", tripId: id, baseRevision: 0 });
 if (role === "viewer") { await expect(generate).rejects.toMatchObject({ code: "not-found" }); expect(f.generate).not.toHaveBeenCalled(); } else await generate;
 await f.app.execute(owner, { version: "trip-api-v1", operation: "mutate", tripId: id, baseRevision: 0, mutationId: f.crypto.id(), proposal: { tripId: id, baseRevision: 0, summary: "再生成", patches: [{ type: "title", title: "出雲大社を訪ねる旅" }] } });
 expect(await f.app.execute(guest, { version: "trip-api-v1", operation: "get", tripId: id })).toMatchObject({ trip: { title: "出雲大社を訪ねる旅", items: f.trip.items } });
 expect(await f.sharing.execute(guest, { version: "trip-sharing-v1", operation: "accessible" })).toMatchObject({ trips: [{ trip: { title: "出雲大社を訪ねる旅" } }] });
});
it("rejects empty trips before spending a model call", async () => {
 const f=fixture(); f.seed({ ...f.trip, items: [] }, owner.subject);
 await expect(f.app.execute(owner, { version: "trip-api-v1", operation: "generate-title", tripId: id, baseRevision: 0 })).rejects.toMatchObject({ code: "invalid-input" }); expect(f.generate).not.toHaveBeenCalled();
});
