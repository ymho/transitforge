import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parseTripCommand, parsePlanAdoptionCommand, parseTripAdoptionCommand, parseItemDecisionCommand } from "../backend/agent-api/src/contracts/trip-api.ts";
import { parseSharingCommand } from "../backend/agent-api/src/contracts/trip-sharing-api.ts";
import { createProfileApiHandler } from "../backend/agent-api/src/server-state-handler.ts";
import { ProfileApplication } from "../backend/agent-api/src/usecases/profile-application.ts";
import { createAgentStreamHandler } from "../backend/agent-api/src/agent-stream-handler.ts";
import { createTrip } from "@raiquora/trip/trip";

const spec = JSON.parse(readFileSync("docs/api/openapi.json", "utf8"));
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema({ $id: "urn:kaiho:openapi", components: spec.components });
const validate = name => ajv.compile({ $ref: `urn:kaiho:openapi#/components/schemas/${name}` });
test("Browser diagnostics publish only bounded, content-free input and an acknowledgement", () => {
  const v = validate("BrowserDiagnosticCommand"), report = { diagnosticId: "11111111-1111-4111-8111-111111111111", occurredAt: "2026-10-11T08:00:00.000Z", buildId: "e0d06e68", code: "aborted", requestSent: true, elapsedMs: 45000, maxSilenceMs: 45000 };
  const command = { version: "browser-agent-diagnostics-v1", operation: "record", reports: [report] };
  assert.equal(v(command), true, JSON.stringify(v.errors));
  for (const reports of [[], Array(5).fill(report), [{ ...report, userRequest: "private" }], [{ ...report, code: "private" }], [{ ...report, httpStatus: 999 }], [{ ...report, elapsedMs: -1 }]]) assert.equal(v({ ...command, reports }), false);
  assert.equal(spec.paths["/api/conversations/diagnostics/v1"].post["x-max-body-bytes"], 4096);
});
const tripId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mutationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const principal = { subject: `identity-v1:${"a".repeat(64)}`, identity: { issuer: "https://identity.example", subject: "fixture" }, scopes: ["raiquora/user"] };
const assertValid = (validator, value) => assert.equal(validator(value), true, JSON.stringify(validator.errors));

test("Trip commands match real parsers, including confirmation and mutation contracts", () => {
  const v = validate("TripCommand");
  const commands = [
    { version: "trip-api-v1", operation: "get", tripId },
    { version: "trip-api-v1", operation: "list", limit: 50 },
    { version: "trip-api-v1", operation: "create", trip: createTrip(tripId, "大阪", "2026-10-11T00:00:00Z") },
    { version: "trip-api-v1", operation: "mutate", tripId, baseRevision: 0, mutationId, proposal: { tripId, baseRevision: 0, summary: "変更", patches: [] } },
    { version: "trip-api-v1", operation: "get", tripId: tripId.toUpperCase() },
  ];
  for (const c of commands) { parseTripCommand(c); assertValid(v, c); }
  for (const [prefix, parser, fields] of [
    ["plan-adoption", parsePlanAdoptionCommand, { conversationId: tripId, candidateSetId: "candidate-1", candidateSetRevision: 0, variantId: "v-1" }],
    ["trip-adoption", parseTripAdoptionCommand, { action: "confirm" }],
    ["item-decision", parseItemDecisionCommand, { itemId: "item-1", action: "confirm" }],
  ]) {
    const c = { version: "trip-api-v1", operation: `confirm-${prefix}`, tripId, baseTripRevision: 0, mutationId, ...fields, confirmationKey: "a".repeat(64) };
    parser(c); assertValid(v, c);
    const { confirmationKey: _key, ...missing } = c;
    assert.throws(() => parser(missing)); assert.equal(v(missing), false);
    const preview = { ...missing, operation: `preview-${prefix}` }; parser(preview); assertValid(v, preview);
    assert.throws(() => parser({ ...preview, confirmationKey: c.confirmationKey })); assert.equal(v({ ...preview, confirmationKey: c.confirmationKey }), false);
  }
  for (const c of [
    { version: "trip-api-v1", operation: "list", limit: 51 },
    { version: "trip-api-v1", operation: "get", tripId, ownerId: "forged" },
    { version: "trip-api-v1", operation: "get", tripId: "invalid" },
  ]) { assert.throws(() => parseTripCommand(c)); assert.equal(v(c), false); }
});

test("sharing commands reject foreign fields and retain real grant roles", () => {
  const v = validate("SharingCommand");
  const command = { version: "trip-sharing-v1", operation: "create-grant", tripId, role: "viewer" };
  parseSharingCommand(command); assertValid(v, command);
  for (const c of [{ ...command, role: "owner" }, { ...command, ownerId: "forged" }]) {
    assert.throws(() => parseSharingCommand(c)); assert.equal(v(c), false);
  }
  assertValid(v, { version: "trip-sharing-v1", operation: "official-import", tripId, guideVersion: 1, newTripId: mutationId, startDate: "2026-10-11", adults: 2, children: 0 });
});

test("profile get wraps ProfileState while update returns profile and revision at the top level", async () => {
  let state;
  const profile = { version: 3, interests: ["railway"], updatedAt: "2026-10-11T00:00:00Z" };
  const app = new ProfileApplication({ get: async () => state, put: async (_p, saved) => state = { profile: saved, revision: 0 }, delete: async () => {} });
  const handler = createProfileApiHandler(app, async () => principal), request = validate("ProfileCommand"), response = validate("ProfileResponse");
  for (const command of [
    { version: "profile-api-v1", operation: "get" },
    { version: "profile-api-v1", operation: "update", profile, expectedRevision: null },
    { version: "profile-api-v1", operation: "get" },
  ]) {
    assertValid(request, command);
    const result = await handler({ rawPath: "/api/profile/v1", httpMethod: "POST", body: JSON.stringify(command) });
    assert.equal(result.statusCode, 200); assertValid(response, JSON.parse(result.body));
  }
  assert.equal(request({ version: "profile-api-v1", operation: "update", profile }), false);
});

test("SSE request and real handler frames follow the declared schema", async () => {
  const request = { userRequest: "大阪へ行きたい", conversationId: tripId, turnId: mutationId };
  const command = validate("StreamCommand"), agent = validate("AgentEventFrame"), done = validate("DoneEventFrame");
  assertValid(command, request);
  assert.equal(command({ ...request, principal }), false);
  const { turnId: _turn, ...missing } = request; assert.equal(command(missing), false);
  const frames = [], statuses = [];
  const handler = createAgentStreamHandler({ path: "/api/agent-stream", conversationTurns: true, verifier: { verify: async () => principal }, newRunId: () => "run-fixture",
    run: async (_input, emit) => { await emit({ type: "progress", phase: "running" }); await emit({ type: "final", status: "completed", response: "大阪への旅行ですね。" }); } });
  await handler({ path: "/api/agent-stream", method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify(request) }, {
    signal: new AbortController().signal, start: status => statuses.push(status), write: async frame => frames.push(frame), end: async () => {} });
  assert.deepEqual(statuses, [200]); assert.equal(frames.length, 3);
  for (const frame of frames) {
    const data = JSON.parse(frame.match(/^data: (.*)$/m)[1]); assertValid(frame.startsWith("event: done") ? done : agent, data);
  }
});

test("read schema excludes retired operations and model injection", () => {
  const v = validate("ReadCommand"), command = { operation: "weather_forecast_search", location: "大阪" };
  assertValid(v, command);
  for (const c of [{ operation: "bedrock_converse" }, { ...command, messages: [] }, { ...command, modelClass: "decision" }]) assert.equal(v(c), false);
  assert.deepEqual(spec.paths["/api/agent"].post.security, [{ CognitoReadToken: [] }]);
  assert.equal(spec.paths["/api/agent-stream"].post.responses["200"].content["text/event-stream"].schema.type, "string");
});

test("unpublished handlers and private identities are not published API contracts", () => {
  assert.equal(Object.keys(spec.paths).length, 7);
  for (const path of spec["x-unpublished"].paths) assert.equal(spec.paths[path], undefined);
  for (const name of ["TrustedPrincipal", "TripPrincipal"]) assert.equal(spec.components.schemas[name], undefined);
  const v = validate("TripResponse"); assertValid(v, { version: "trip-api-v1" });
  assert.equal(v({ version: "trip-api-v1", unknownShape: true }), false);
});
