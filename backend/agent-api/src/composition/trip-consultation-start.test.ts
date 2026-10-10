import { expect, it, vi } from "vitest";
import { DynamoDbTripConsultationRepository } from "../adapters/dynamodb-trip-consultation-repository.js";
import { DynamoDbTripRepository } from "../adapters/dynamodb-trip-repository.js";
import { TripApplication } from "../usecases/trip-application.js";
import { createTripApiHandler } from "../trip-handler.js";
import { createHttpPrincipalResolver } from "../http-auth-composition.js";
import { cognitoTokenFixture, token, scope } from "../adapters/cognito-token.fixture.js";
import { tripConsultationDynamoFixture } from "../adapters/trip-consultation-dynamo.fixture.js";
const tripId = "75300000-0000-4000-8000-000000000001";
it("authenticates the atomic start through the normal Trip API and rejects client-supplied state/authority", async () => {
  const f = tripConsultationDynamoFixture(), { verifier } = cognitoTokenFixture();
  const repository = new DynamoDbTripRepository("test-trips",f.client,f.clock);
  const start = new DynamoDbTripConsultationRepository("test-trips","test-state",f.client,f.clock);
  const app = new TripApplication(repository,repository, f.clock, undefined, undefined, undefined, undefined, start);
  const handle = createTripApiHandler(app,{ authenticate: createHttpPrincipalResolver(verifier,[scope]) });
  const body = { version: "trip-api-v1", operation: "start-consultation", tripId, title: "出雲大社へ" };
  const request = (value: object, access?: string) => ({ rawPath: "/api/trips/v1", httpMethod: "POST", headers: access ? { authorization: `Bearer ${access}` } : {}, body: JSON.stringify(value) });
  expect((await handle(request(body))).statusCode).toBe(401); expect(f.rows.size).toBe(0);
  for (const extra of [{ owner: "someone-else" },{ principal: { subject: "forged" } },{ trip: { items: [] } },{ history: [] },{ profile: {} }]) {
    expect((await handle(request({ ...body, ...extra },token()))).statusCode).toBe(400);
  }
  expect(f.rows.size).toBe(0);
  const saved = await handle(request(body,token())); expect(saved.statusCode).toBe(200);
  const value = JSON.parse(saved.body); expect(value).toMatchObject({ version: "trip-api-v1", conversationId: tripId, trip: { id: tripId, planningState: "inspiration" } });
  expect(JSON.stringify(value)).not.toMatch(/ownerSubject|identity-v1/);
  const replay = await handle(request(body,token())); expect(replay.body).toBe(saved.body);
  const foreignGet = await handle(request({ version: "trip-api-v1", operation: "get", tripId },token({ sub: "other" })));
  expect(foreignGet.statusCode).toBe(404);
});

it("classifies before any atomic write and never creates a Trip for a maths request or classifier failure", async () => {
  const f = tripConsultationDynamoFixture();
  const repository = new DynamoDbTripRepository("test-trips", f.client, f.clock);
  const start = new DynamoDbTripConsultationRepository("test-trips", "test-state", f.client, f.clock);
  const scope = { classify: vi.fn(async () => "out-of-scope" as const) };
  const app = new TripApplication(repository, repository, f.clock, undefined, undefined, undefined, undefined, start, undefined, scope);
  const principal = { subject: "test-user" };
  const command = { version: "trip-api-v1", operation: "start-consultation", tripId, title: "数学の質問", userRequest: "積分の公式を教えて" };
  expect(await app.execute(principal, command)).toMatchObject({ status: "out-of-scope" });
  expect(scope.classify).toHaveBeenCalledWith("積分の公式を教えて"); expect(f.rows.size).toBe(0);
  scope.classify.mockRejectedValueOnce(new Error("timeout"));
  await expect(app.execute(principal, command)).rejects.toThrow("timeout"); expect(f.rows.size).toBe(0);
});
it("allows a travel request to create its Trip and conversation after admission", async () => {
  const f = tripConsultationDynamoFixture();
  const repository = new DynamoDbTripRepository("test-trips", f.client, f.clock);
  const start = new DynamoDbTripConsultationRepository("test-trips", "test-state", f.client, f.clock);
  const scope = { classify: vi.fn(async () => "travel" as const) };
  const app = new TripApplication(repository, repository, f.clock, undefined, undefined, undefined, undefined, start, undefined, scope);
  expect(await app.execute({ subject: "test-user" }, { version: "trip-api-v1", operation: "start-consultation", tripId, title: "京都へ行きたい" })).toMatchObject({ trip: { id: tripId }, conversationId: tripId });
  expect(scope.classify).toHaveBeenCalledWith("京都へ行きたい"); expect(f.rows.size).toBeGreaterThan(0);
});
