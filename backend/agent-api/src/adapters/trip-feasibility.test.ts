import { expect, it } from "vitest";
import { TripApplication } from "../usecases/trip-application.js";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { feasibilityTrip, feasibilityActivity, feasibilityInstant, feasibilityStayTrip } from "../../../../modules/trip/domain/trip-feasibility.fixture";
import { reservationFact } from "@raiquora/trip/reservation";
import { reservationFixture } from "../../../../modules/trip/domain/reservation.fixture";
import type { Trip } from "@raiquora/trip/trip";
import { createTripApiHandler } from "../trip-handler.js";

const owner = { subject: "owner-A" };
const initial = { ...feasibilityTrip(), revision: 5 };
const ready = () => ({ version: "trip-api-v1", operation: "mutate", tripId: initial.id, baseRevision: 5,
  mutationId: "22222222-2222-4222-8222-222222222222", proposal: { tripId: initial.id, baseRevision: 5, summary: "準備完了にする",
    patches: [{ type: "planning", state: "ready" }] } });
it("certifies actual proposed revision 5, commits 6, and preserves successful retry without extra evaluation", async () => {
  const f = tripDynamoFixture(); f.seed(initial); let reads = 0;
  const app = new TripApplication(f.repository, f.repository, f.clock, { facts: async () => { reads++; return []; } });
  const result = await app.execute(owner, ready());
  expect(result).toMatchObject({ revision: 6, trip: { planningState: "ready" } });
  expect(await app.execute(owner, ready())).toEqual(result); expect(reads).toBe(1);
});
it("rejects unknown reservation facts, overlap in post-proposal content, and model-provided proof", async () => {
  const f = tripDynamoFixture(); f.seed(initial);
  const unavailable = new TripApplication(f.repository, f.repository, f.clock);
  await expect(unavailable.execute(owner, ready())).rejects.toMatchObject({ code: "feasibility-required" });
  const app = new TripApplication(f.repository, f.repository, f.clock, { facts: async () => [] });
  const bad = { ...ready(), proposal: { ...ready().proposal, patches: [
    { type: "add", item: feasibilityActivity("overlap") }, ...ready().proposal.patches,
  ] } };
  await expect(app.execute(owner, bad)).rejects.toMatchObject({ code: "feasibility-required" });
  await expect(app.execute(owner, { ...ready(), feasibility: { status: "feasible", tripRevision: 5 } })).rejects.toMatchObject({ code: "invalid-input" });
  expect(await f.repository.get(owner, initial.id)).toEqual(initial);
});
it("rejects booked fixed conflict and create ready bypass; permits ordinary draft saves", async () => {
  const f = tripDynamoFixture(); f.seed(initial);
  const facts = [reservationFact(reservationFixture({ startsAt: feasibilityInstant(8) }))];
  const app = new TripApplication(f.repository, f.repository, f.clock, { facts: async () => facts });
  await expect(app.execute(owner, ready())).rejects.toMatchObject({ code: "feasibility-required" });
  await expect(app.execute(owner, { version: "trip-api-v1", operation: "create", trip: { ...initial, revision: 0, planningState: "ready" } })).rejects.toMatchObject({ code: "feasibility-required" });
  const draft = { ...ready(), proposal: { ...ready().proposal, patches: [{ type: "planning", state: "itinerary_draft" }] } };
  expect(await app.execute(owner, draft)).toMatchObject({ revision: 6 });
});
it("prevents stale revision and CAS race after feasibility; never blindly rebases", async () => {
  const f = tripDynamoFixture(); f.seed(initial);
  const newer = { ...initial, revision: 6, title: "別の編集" };
  const app = new TripApplication(f.repository, f.repository, f.clock, { facts: async () => [] });
  f.faults.beforeTransaction = () => f.seed(newer);
  await expect(app.execute(owner, ready())).rejects.toMatchObject({ code: "conflict" });
  expect(await f.repository.get(owner, initial.id)).toEqual(newer);
  await expect(app.execute(owner, ready())).rejects.toMatchObject({ code: "conflict" });
});
it("re-evaluates externally changed ready Trip without rewriting planning state", async () => {
  const f = tripDynamoFixture(); const saved: Trip = { ...initial, planningState: "ready" }; f.seed(saved);
  const app = new TripApplication(f.repository, f.repository, f.clock);
  expect(await app.execute(owner, { version: "trip-api-v1", operation: "get", tripId: initial.id })).toMatchObject({ trip: saved });
});
it("returns a distinct feasibility error without exposing booking data in HTTP or logs", async () => {
  const f = tripDynamoFixture(); f.seed(initial); const logs: unknown[] = [];
  const app = new TripApplication(f.repository, f.repository, f.clock, { facts: async () => [reservationFact(reservationFixture({ startsAt: feasibilityInstant(8) }))] });
  const handler = createTripApiHandler(app, { authenticate: async () => owner, log: (record) => { logs.push(record); } });
  const result = await handler({ requestContext: { http: { method: "POST" } }, body: JSON.stringify(ready()) }, { awsRequestId: "feasibility" });
  expect(result.statusCode).toBe(409); expect(JSON.parse(result.body)).toMatchObject({ error: "feasibility-required" });
  expect(JSON.stringify([result, logs])).not.toMatch(/PRIVATE|bookingReference|startsAt/);
});
it("commits selected-stay ready with non-blocking precision and preserves day snapshot through CAS", async () => {
  const f = tripDynamoFixture(), overnight = feasibilityStayTrip();
  const trip = { ...overnight.trip, revision: 5 }; f.seed(trip);
  const app = new TripApplication(f.repository, f.repository, f.clock, { facts: async () => [] },
    { external: async () => overnight.facts.external });
  const result = await app.execute(owner, ready());
  expect(result).toMatchObject({ revision: 6, trip: { planningState: "ready", items: trip.items } });
  expect((result.trip as Trip).items[1]!.schedule).toEqual(overnight.stay.schedule);
  const read = new TripApplication(f.repository, f.repository, f.clock);
  expect(await read.execute(owner, { version: "trip-api-v1", operation: "get", tripId: trip.id })).toMatchObject({ trip: { planningState: "ready" } });
});
