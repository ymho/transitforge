import { describe, expect, it, vi } from "vitest";
import { createTripSharingHandler } from "./trip-sharing-handler.js";
import { createNotificationHandler } from "./notification-handler.js";
import { createInTripContextHandler } from "./in-trip-context-handler.js";
import { createPersonalApiHandler } from "./personal-api-composition.js";
import { createHttpPrincipalResolver } from "./http-auth-composition.js";
import { personalApiPolicies, apiAuthenticationInventory } from "./adapters/api-route-policy.js";
import { cognitoTokenFixture, token, scope, pool } from "./adapters/cognito-token.fixture.js";
import { tripDynamoFixture } from "./adapters/trip-dynamodb.fixture.js";
import { DynamoDbTripSharing } from "./adapters/dynamodb-trip-sharing.js";
import { CryptographicShareSecret } from "./adapters/share-secret.js";
import { TripSharingApplication } from "./usecases/trip-sharing-application.js";
import { InTripContextApplication } from "./usecases/in-trip-context-application.js";
import { createTrip } from "@raiquora/trip/trip";

const id = "11111111-1111-4111-8111-111111111111";
const event = (path: string, body: object, access?: string) => ({ path, httpMethod: "POST", body: JSON.stringify(body),
  headers: access ? { Authorization: `Bearer ${access}` } : {} });
describe("other stable personal handlers share the same authentication", () => {
  it("enforces 401/403 before each Application, and rejects unknown operations", async () => {
    const { verifier } = cognitoTokenFixture(), authenticate = createHttpPrincipalResolver(verifier, [scope]);
    const execute = vi.fn(async (_principal: unknown, _input: unknown) => ({})), list = vi.fn(async () => ({ notifications: [] })), read = vi.fn(async () => undefined);
    const routes = [
      { policy: personalApiPolicies.sharing, h: createTripSharingHandler({ execute }, { authenticate }), fields: { operation: "accessible" } },
      { policy: personalApiPolicies.notification, h: createNotificationHandler({ list, read }, authenticate), fields: { operation: "list" } },
      { policy: personalApiPolicies.inTrip, h: createInTripContextHandler({ read }, authenticate), fields: { tripId: id } },
    ];
    for (const { policy, h, fields } of routes) {
      const body = { version: policy.version, ...fields };
      for (const [access, status] of [[undefined, 401], ["invalid", 401], [token({ scope: "openid" }), 403]] as const) {
        const r = await h(event(policy.path, body, access)); expect(r.statusCode).toBe(status);
        expect(r.headers["cache-control"]).toBe("no-store");
      }
      expect((await h(event(policy.path, { ...body, operation: "worker-send" }, token()))).statusCode).toBe(400);
    }
    expect(execute).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    for (const { policy, h, fields } of routes) {
      expect((await h(event(policy.path, { version: policy.version, ...fields }, token()))).statusCode).toBe(200);
    }
    const principal = await verifier.verify(token());
    expect(list).toHaveBeenCalledWith(principal, undefined);
    expect(read).toHaveBeenCalledWith(principal, id);
    expect(execute.mock.calls[0]?.[0]).toEqual(principal);
  });
  it("Sharing management and In-trip reads retain owner isolation after JWT authentication", async () => {
    const f = tripDynamoFixture(), { verifier } = cognitoTokenFixture(), authenticate = createHttpPrincipalResolver(verifier, [scope]);
    const owner = await verifier.verify(token()), b = token({ sub: "other-user" });
    f.seed(createTrip(id, "private trip", "2026-09-13T00:00:00Z"), owner.subject);
    const repo = new DynamoDbTripSharing("test-trips", f.client, f.clock);
    const app = new TripSharingApplication(f.repository, repo, new CryptographicShareSecret(), repo, f.clock);
    const sharing = createTripSharingHandler(app, { authenticate });
    const body = { version: "trip-sharing-v1", operation: "manage", tripId: id };
    expect((await sharing(event(personalApiPolicies.sharing.path, body, token()))).statusCode).toBe(200);
    const denied = await sharing(event(personalApiPolicies.sharing.path, body, b));
    expect(denied.statusCode).toBe(404);
    expect(denied.body).toBe((await sharing(event(personalApiPolicies.sharing.path, { ...body, tripId: "22222222-2222-4222-8222-222222222222" }, b))).body);
    const context = new InTripContextApplication(f.repository, { observations: vi.fn() }, { read: vi.fn() }, { facts: vi.fn() }, { forSubjects: vi.fn() });
    const inTrip = createInTripContextHandler(context, authenticate), readBody = { version: "in-trip-api-v1", tripId: id };
    expect((await inTrip(event(personalApiPolicies.inTrip.path, readBody, token()))).statusCode).toBe(200);
    expect((await inTrip(event(personalApiPolicies.inTrip.path, readBody, b))).statusCode).toBe(404);
  });
  it("keeps host default-off, rejects unknown paths and does not route Agent or IAM workers", async () => {
    const options = { auth: { userPoolId: pool, clientId: "app-client", requiredScopes: [scope] }, tripTable: "trips", notificationTable: "notifications" };
    expect((await createPersonalApiHandler(options)({})).statusCode).toBe(501);
    const host = createPersonalApiHandler({ ...options, enabled: true });
    for (const path of ["/api/agent", "/api/conversations", "/api/profile", "/api/trips/unknown", "/trip-changed-lambda"]) {
      expect((await host(event(path, {}, token()))).statusCode).toBe(404);
    }
    for (const policy of Object.values(personalApiPolicies)) {
      expect((await host(event(policy.path, { version: policy.version }))).statusCode).toBe(401);
    }
    expect(apiAuthenticationInventory.internalIamOnly).toEqual(["trip-changed-lambda", "rail-impact-lambda", "trip-recheck-lambda", "notification-lambda"]);
  });
});
