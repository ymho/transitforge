import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createTripApiHandler } from "./trip-handler.js";
import { createHttpPrincipalResolver } from "./http-auth-composition.js";
import { cognitoTokenFixture, token, scope } from "./adapters/cognito-token.fixture.js";
import { tripDynamoFixture } from "./adapters/trip-dynamodb.fixture.js";
import { TripApplication } from "./usecases/trip-application.js";
import { DynamoDbTripSharing } from "./adapters/dynamodb-trip-sharing.js";
import { CryptographicShareSecret } from "./adapters/share-secret.js";
import { TripSharingApplication } from "./usecases/trip-sharing-application.js";

const aId = "11111111-1111-4111-8111-111111111111", bId = "22222222-2222-4222-8222-222222222222";
const missingId = "33333333-3333-4333-8333-333333333333";
const aToken = token(), bToken = token({ sub: "user-b" });
const event = (command: object, access = aToken) => ({ rawPath: "/api/trips/v1", requestContext: { http: { method: "POST" } },
  headers: { authorization: `Bearer ${access}` }, body: JSON.stringify({ version: "trip-api-v1", ...command }) });
const mutation = (tripId = aId) => ({ operation: "mutate", tripId, baseRevision: 0, mutationId: "44444444-4444-4444-8444-444444444444",
  proposal: { tripId, baseRevision: 0, summary: "散策を追加", patches: [{ type: "add", item: {
    id: "walk", title: "散策", type: "activity", category: "free-time", schedule: { type: "unscheduled" },
  } }] } });
function fixture() {
  const f = tripDynamoFixture(), { verifier } = cognitoTokenFixture();
  const repository = new DynamoDbTripSharing("trips", f.client);
  const sharing = new TripSharingApplication(f.repository, repository, new CryptographicShareSecret(), repository);
  const app = new TripApplication(f.repository, f.repository, f.clock, undefined, undefined, sharing);
  const execute = vi.spyOn(app, "execute"), log = vi.fn();
  const handler = createTripApiHandler(app, { authenticate: createHttpPrincipalResolver(verifier, [scope]), log });
  return { ...f, handler, execute, log, verifier };
}
async function seeded() {
  const f = fixture();
  expect((await f.handler(event({ operation: "create", trip: createTrip(aId, "A private", "2026-09-13T00:00:00Z") }))).statusCode).toBe(200);
  expect((await f.handler(event({ operation: "create", trip: createTrip(bId, "B private", "2026-09-13T00:00:00Z") }, bToken))).statusCode).toBe(200);
  return f;
}

describe("Trip HTTP authenticated owner isolation with real JWT/JWKS and repository", () => {
  it("rejects missing/invalid/ID/expired token and insufficient scope before Application/storage", async () => {
    const f = fixture();
    for (const [access, status] of [["", 401], ["bad", 401], [token({ token_use: "id" }), 401], [token({ exp: 1 }), 401], [token({ scope: "openid" }), 403]] as const) {
      const e = event({ operation: "list", ownerId: "forged" }, access);
      if (!access) e.headers = {} as typeof e.headers;
      const response = await f.handler(e);
      expect(response.statusCode).toBe(status); expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toMatch(/eyJ|forged|scope|client_id/);
    }
    expect(f.execute).not.toHaveBeenCalled(); expect(f.commands).toHaveLength(0);
    expect(JSON.stringify(f.log.mock.calls)).not.toMatch(/Bearer|eyJ|forged/);
  });
  it("A reads A; B cannot distinguish A's Trip from absence, and lists stay owner-scoped", async () => {
    const f = await seeded();
    expect(JSON.parse((await f.handler(event({ operation: "get", tripId: aId }))).body).trip.title).toBe("A private");
    const other = await f.handler(event({ operation: "get", tripId: aId }, bToken));
    const missing = await f.handler(event({ operation: "get", tripId: missingId }, bToken));
    expect(other.statusCode).toBe(404); expect(other.body).toBe(missing.body);
    for (const [access, id] of [[aToken, aId], [bToken, bId]]) {
      const result = JSON.parse((await f.handler(event({ operation: "list" }, access))).body);
      expect(result.trips.map((trip: { id: string }) => trip.id)).toEqual([id]);
    }
    const forged = event({ operation: "get", tripId: aId }, bToken);
    Object.assign(forged.headers, { ownerId: (await f.verifier.verify(aToken)).subject, "x-user-id": "user-a" });
    expect((await f.handler(forged)).statusCode).toBe(404);
    expect((await f.handler(event({ operation: "get", tripId: aId, ownerId: "user-a" }, bToken))).statusCode).toBe(400);
  });
  it("mutations retain CAS/idempotency and cannot use another owner's resource/receipt", async () => {
    const f = await seeded();
    const other = await f.handler(event(mutation(), bToken)), missing = await f.handler(event(mutation(missingId), bToken));
    expect(other.statusCode).toBe(404); expect(other.body).toBe(missing.body);
    const accepted = await f.handler(event(mutation())); expect(accepted.statusCode).toBe(200);
    expect(JSON.parse(accepted.body)).toMatchObject({ revision: 1, trip: { revision: 1 } });
    expect((await f.handler(event(mutation()))).body).toBe(accepted.body);
    expect((await f.handler(event({ ...mutation(), mutationId: missingId }))).statusCode).toBe(409);
    expect((await f.handler(event(mutation(), bToken))).statusCode).toBe(404);
    expect((await f.handler(event({ operation: "archive", tripId: aId }, bToken))).statusCode).toBe(404);
    expect((await f.handler(event({ operation: "archive", tripId: aId }))).statusCode).toBe(200);
    expect((await f.handler(event({ operation: "get", tripId: aId }))).statusCode).toBe(404);
  });
  it("conversation references use the same owner and unknown operations/paths never reach Application", async () => {
    const f = await seeded(); const conversationId = missingId;
    expect((await f.handler(event({ operation: "attach", conversationId, tripId: aId }))).statusCode).toBe(200);
    expect(JSON.parse((await f.handler(event({ operation: "reference", conversationId }, bToken))).body).tripId).toBeUndefined();
    expect((await f.handler(event({ operation: "attach", conversationId, tripId: aId }, bToken))).statusCode).toBe(404);
    f.execute.mockClear();
    for (const operation of ["replace", "__proto__", "constructor", "unknown", undefined]) {
      expect((await f.handler(event({ operation }))).statusCode).toBe(400);
    }
    expect((await f.handler({ ...event({ operation: "list" }), rawPath: "/api/trips/unknown" })).statusCode).toBe(400);
    expect(f.execute).not.toHaveBeenCalled();
  });
});
