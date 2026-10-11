import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as TJS from "typescript-json-schema";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import { personalApiPolicies } from "../backend/agent-api/src/adapters/api-route-policy.ts";
import { legacyReadOperations } from "../backend/agent-api/src/legacy-agent-ingress.ts";

const output = "docs/api/openapi.json";
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ "application/json": { schema } });
const errorSchema = (version, errors) => ({ type: "object", required: ["error", ...(version ? ["version"] : [])],
  properties: { ...(version ? { version: { const: version } } : {}), error: { type: "string", enum: errors } }, additionalProperties: false });
const headers = { "Cache-Control": { schema: { type: "string" }, description: "個人応答はno-store。" },
  "X-Transitforge-Request-Id": { schema: { type: "string" }, description: "Handlerが返す安全な相関ID。Gatewayで拒否した応答には付かない。" } };

function rewriteRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === "$ref" ? `#/components/schemas/${schemaName(decodeURIComponent(item.slice("#/definitions/".length)))}` : rewriteRefs(item)]));
  // TypeScript generator emits draft-07 tuples; OAS 3.1 uses JSON Schema 2020-12.
  if (Array.isArray(result.items)) {
    result.prefixItems = result.items;
    result.items = result.additionalItems ?? true;
    delete result.additionalItems;
  }
  return result;
}
function schemaName(name) { return name.replace(/[^A-Za-z0-9._-]/gu, "_"); }
function resolve(schema, schemas) {
  return schema.$ref ? resolve(schemas[schema.$ref.slice("#/components/schemas/".length)], schemas) : schema;
}
function variants(schema, schemas) {
  const s = resolve(schema, schemas);
  if (s.anyOf || s.oneOf) return (s.anyOf ?? s.oneOf).flatMap(child => variants(child, schemas));
  if (!s.allOf) return [structuredClone(s)];
  let result = [{ type: "object", properties: {}, required: [] }];
  for (const part of s.allOf) result = result.flatMap(left => variants(part, schemas).map(right => ({ type: "object",
    properties: { ...left.properties, ...right.properties }, required: [...new Set([...left.required, ...(right.required ?? [])])].sort() })));
  return result;
}
function operations(schema) { return schema.properties?.operation?.enum ?? (schema.properties?.operation?.const ? [schema.properties.operation.const] : []); }
function operationIndex(root, schemas) {
  const index = {};
  for (const variant of variants(schemas[root], schemas)) {
    // HTTP commands reject unknown fields. Domain snapshots keep their existing validator behavior.
    variant.additionalProperties = false;
    variant.properties.operation = resolve(variant.properties.operation, schemas);
    for (const operation of operations(variant)) {
      if (index[operation]) throw new Error(`Duplicate command ${root}/${operation}`);
      index[operation] = variant;
    }
  }
  schemas[root] = { oneOf: Object.values(index).filter((s, i, a) => a.indexOf(s) === i) };
  return index;
}

/** Only transport-validator constraints belong here. Cross-field/Domain checks still run on Server. */
function refineCommands(root, index) {
  const uuid = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
  const revision = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 };
  const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
  for (const [operation, schema] of Object.entries(index)) {
    const p = schema.properties;
    const patch = (name, constraints) => { if (p[name]) p[name] = { ...p[name], ...constraints }; };
    for (const field of ["tripId", "mutationId", "sourceTripId", "newTripId", "afterTripId", "grantId", "participantId"]) patch(field, uuid);
    for (const field of ["baseRevision", "baseTripRevision", "sourceRevision", "candidateSetRevision", "guideVersion", "baseVersion"]) patch(field, revision);
    patch("expectedRevision", root === "ProfileCommand" && operation === "update" ? { type: ["integer", "null"], minimum: 0, maximum: revision.maximum } : revision);
    patch("confirmationKey", { type: "string", pattern: "^[0-9a-f]{64}$" });
    if (root === "ConversationCommand") { patch("conversationId", uuid); patch("turnId", uuid); }
    if (root === "TripCommand") patch("conversationId", { type: "string", pattern: "^[A-Za-z0-9_-]{1,100}$" });
    patch("title", { minLength: 1, maxLength: 160 });
    patch("itemId", { minLength: 1, maxLength: 160 });
    if (root === "TripCommand") {
      for (const field of ["tripId", "mutationId", "sourceTripId", "afterTripId"]) patch(field, { pattern: uuid.pattern.replaceAll("a-f", "a-fA-F") });
      patch("limit", { type: "integer", minimum: 1, maximum: 50 });
      patch("userRequest", { minLength: 1, maxLength: 32000 });
      for (const field of ["candidateSetId", "variantId"]) patch(field, { pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$" });
    }
    if (root === "SharingCommand") {
      // Trip sharing accepts UUIDs case-insensitively.
      for (const field of ["tripId", "grantId", "participantId", "afterTripId", "newTripId"]) patch(field, { pattern: uuid.pattern.replaceAll("a-f", "a-fA-F") });
      patch("secret", { pattern: "^[A-Za-z0-9_-]{43}$" });
      patch("expiresAt", { type: "string", format: "date-time" });
      patch("startDate", date); patch("adults", { type: "integer", minimum: 1, maximum: 50 }); patch("children", { type: "integer", minimum: 0, maximum: 20 });
    }
    if (root === "ReadCommand") {
      // Several read validators normalize or ignore additional inputs; match that behavior.
      schema.additionalProperties = !["travel_alert_search"].includes(operation);
      schema.not = { anyOf: ["messages", "toolDefinitions", "modelClass", "modelCallId"].map(name => ({ required: [name] })) };
      patch("serviceDate", date); patch("checkInDate", date); patch("checkOutDate", date);
      if (operation === "journey_search") {
        patch("departureTimeMinutes", { minimum: 0, maximum: 2880 }); patch("arrivalTimeLimitMinutes", { minimum: 0, maximum: 2880 });
        patch("limit", { type: "integer", minimum: 1, maximum: 5 });
      }
      if (operation === "travel_accommodation_search") {
        patch("destination", { minLength: 1, maxLength: 80 }); patch("adults", { type: "integer", minimum: 1, maximum: 10 }); patch("limit", { type: "integer", minimum: 1, maximum: 10 });
      }
      if (operation === "weather_forecast_search") patch("location", { minLength: 1, maxLength: 100 });
      if (operation === "weather_grid_search") patch("points", { minItems: 1, maxItems: 64 });
    }
  }
}

export async function generateOpenApi() {
  const program = TJS.programFromConfig("backend/agent-api/tsconfig.json", ["tools/openapi-contract.ts"]);
  const model = TJS.generateSchema(program, "OpenApiModels", { required: true, aliasRef: true, strictNullChecks: true });
  if (!model) throw new Error("Cannot generate public HTTP schemas");
  const schemas = {};
  for (const [name, schema] of Object.entries(model.definitions ?? {})) {
    const safe = schemaName(name);
    if (schemas[safe]) throw new Error(`Schema name collision: ${safe}`);
    schemas[safe] = rewriteRefs(schema);
  }
  for (const [name, schema] of Object.entries(model.properties)) {
    const value = rewriteRefs(schema);
    if (value.$ref !== `#/components/schemas/${name}`) schemas[name] = value;
  }
  const indexes = {};
  for (const name of ["ConversationCommand", "ProfileCommand", "TripCommand", "SharingCommand", "ReadCommand", "BrowserDiagnosticCommand"]) {
    indexes[name] = operationIndex(name, schemas); refineCommands(name, indexes[name]);
  }
  for (const name of ["ConversationResponse", "ProfileResponse", "TripResponse", "SharingResponse", "ReadResponse", "BrowserDiagnosticResponse"]) {
    schemas[name] = { anyOf: variants(schemas[name], schemas).map(s => ({ ...s, additionalProperties: false })) };
  }
  // Structures whose bounds are checked separately from command dispatch.
  for (const s of Object.values(schemas)) {
    if (s.properties?.limit && s.properties?.after && Object.keys(s.properties).length === 2) {
      s.additionalProperties = false; s.properties.limit = { type: "integer", minimum: 1, maximum: 50, default: 20 };
    }
    if (s.properties?.scope?.const === "trip" && s.properties?.resolvedTopics && s.properties?.pendingTopics) {
      s.properties.title.maxLength = 160; s.properties.summary.maxLength = 4000;
      for (const name of ["resolvedTopics", "pendingTopics"]) { s.properties[name].maxItems = 20; s.properties[name].items = { type: "string", maxLength: 200 }; }
    }
    if (s.properties?.version?.const === 3 && s.properties?.usualOrigin && s.properties?.considerations) {
      s.additionalProperties = false;
    }
  }
  if (schemas.ConversationMetadata) schemas.ConversationMetadata.additionalProperties = false;
  const stream = resolve(schemas.StreamCommand, schemas);
  stream.additionalProperties = false;
  stream.properties.userRequest = { type: "string", minLength: 1, maxLength: 8000, description: "空白だけの相談は拒否する。" };
  for (const name of ["conversationId", "turnId", "tripId"]) stream.properties[name] = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
  const context = resolve(stream.properties.uiContext, schemas);
  context.additionalProperties = false;
  context.properties.itemId = { type: "string", minLength: 1, maxLength: 200, pattern: "^[^\\u0000-\\u001f\\u007f]+$" };
  context.properties.calendarDate = { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
  const paths = {};
  const diagnosticCommand = indexes.BrowserDiagnosticCommand.record;
  diagnosticCommand.additionalProperties = false;
  diagnosticCommand.properties.reports.minItems = 1;
  diagnosticCommand.properties.reports.maxItems = 4;
  const diagnostic = resolve(diagnosticCommand.properties.reports.items, schemas);
  diagnostic.additionalProperties = false;
  for (const key of ["diagnosticId", "turnId", "runId"]) diagnostic.properties[key] = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
  diagnostic.properties.occurredAt = { type: "string", format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" };
  diagnostic.properties.buildId = { type: "string", pattern: "^(?:[0-9a-f]{7,40}|development)$" };
  for (const key of ["elapsedMs", "maxSilenceMs", "headersMs", "firstByteMs"]) diagnostic.properties[key] = { type: "integer", minimum: 0, maximum: 600000 };
  diagnostic.properties.httpStatus = { type: "integer", minimum: 100, maximum: 599 };
  indexes.BrowserDiagnosticCommand.record = diagnosticCommand;
  const routes = [
    ["conversation", "ConversationCommand", "ConversationResponse", 160 * 1024, "会話の作成・履歴・更新・削除"],
    ["profile", "ProfileCommand", "ProfileResponse", 160 * 1024, "任意のProfile V3の取得・CAS保存・削除"],
    ["trip", "TripCommand", "TripResponse", 256 * 1024, "旅程・予定・相談・候補採用の操作"],
    ["sharing", "SharingCommand", "SharingResponse", 8192, "共有・参加者・公式しおりの操作"],
    ["browserDiagnostics", "BrowserDiagnosticCommand", "BrowserDiagnosticResponse", 4096, "本文を含まないブラウザー通信障害の診断記録"],
  ];
  for (const [name, command, response, bytes, summary] of routes) {
    const policy = personalApiPolicies[name];
    const defined = Object.keys(indexes[command]).sort();
    if (JSON.stringify(defined) !== JSON.stringify([...policy.operations].sort())) throw new Error(`${name}: HTTP allowlist/schema mismatch`);
    const responses = { "200": { description: "正常応答。operationごとに応答の形が異なる。", headers, content: json(ref(response)) } };
    const statuses = { 400: ["invalid-input"], 401: ["unauthenticated"], 403: ["forbidden"], 404: ["not-found"], 409: name === "trip" ? ["already-exists", "conflict", "mutation-reused", "confirmation-required", "feasibility-required"] : ["conflict"], 501: ["unavailable"] };
    if (name === "trip" || name === "sharing") statuses[413] = ["payload-too-large"];
    if (name === "sharing") { delete statuses[501]; statuses[503] = ["unavailable"]; }
    if (name === "browserDiagnostics") { delete statuses[404]; delete statuses[409]; delete statuses[501]; }
    for (const [status, errors] of Object.entries(statuses)) responses[status] = {
      description: errors.join(" / "), headers: { ...headers, ...(status === "401" ? { "WWW-Authenticate": { schema: { const: "Bearer" } } } : {}) }, content: json(errorSchema(policy.version, errors)) };
    // Production-host disabled gate has no version. Handler-only default gates are not published paths.
    if (name !== "sharing") responses[503] = { description: "Production hostを無効にしている場合。", content: json(errorSchema(undefined, ["unavailable"])) };
    else responses[503].content["application/json"].schema = { anyOf: [responses[503].content["application/json"].schema, errorSchema(undefined, ["unavailable"])] };
    paths[policy.path] = { post: { operationId: `${name}Command`, tags: [name], summary,
      description: "同一originのPOST。query parameterは受け付けない。Cognito Access Tokenのraiquora/user scopeが必要。ownerはサーバーが解決する。競合時は最新revisionを取得して再判断する。",
      "x-required-scopes": ["raiquora/user"], "x-max-body-bytes": bytes, "x-operations": defined,
      requestBody: { required: true, content: json(ref(command)) }, responses } };
  }
  if (JSON.stringify(Object.keys(indexes.ReadCommand).sort()) !== JSON.stringify([...legacyReadOperations].sort())) throw new Error("Legacy read allowlist/schema mismatch");
  const readError = { anyOf: [{ type: "object", required: ["message"], properties: { message: { type: "string" } } },
    errorSchema("agent-api", ["unauthenticated", "forbidden"]),
    { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "retryable"], properties: { code: { type: "string" }, retryable: { type: "boolean" } } } } }] };
  paths["/api/agent"] = { post: { operationId: "readCommand", tags: ["read"], summary: "残存する独立検索・分析入口",
    description: "CloudFront OACがAuthorizationを使用するため、利用者のCognito Access TokenはX-Raiquora-Access-Token: Bearer <token>に入れる。旧会話・feedback・trace・未知operationは410。モデルのmessages/toolDefinitions/modelClass/modelCallIdは受け付けない。",
    security: [{ CognitoReadToken: [] }], "x-required-scopes": ["raiquora/user"], "x-max-body-bytes": 2097152,
    "x-operations": Object.keys(indexes.ReadCommand).sort(), requestBody: { required: true, content: json(ref("ReadCommand")) },
    responses: { "200": { description: "検索結果。Providerの未取得状態はExternalTravelInformationに含まれる。", headers, content: json(ref("ReadResponse")) },
      ...Object.fromEntries([400, 401, 403, 405, 410, 413, 422, 500, 503].map(status => [status, { description: "入力・認証・廃止経路・Providerエラー。", headers, content: json(readError) }])) } } };
  paths["/api/agent-stream"] = { post: { operationId: "conversationTurn", tags: ["agent"], summary: "旅行相談を実行しSSEを受信する",
    description: "POST/fetchによるSSE。conversationIdとturnIdが必須。event: agentのdataはAgentEventFrame、event: doneのdataはDoneEventFrame。: heartbeatは接続維持のみ。v=1、同じrunId、seqは1から単調増加。final/errorの後にdoneを確認する。HTTP 200・EOFだけでは成功と扱わず、自動再接続しない。",
    "x-required-scopes": ["raiquora/user"], "x-max-body-bytes": 40000, requestBody: { required: true, content: json(ref("StreamCommand")) },
    responses: { "200": { description: "SSE wire stream。HTTP 200開始後の失敗はAgentEventFrameのerror event。",
      content: { "text/event-stream": { schema: { type: "string" }, example: 'event: agent\ndata: {"v":1,"runId":"run-example","seq":1,"event":{"type":"progress","phase":"running"}}\n\nevent: agent\ndata: {"v":1,"runId":"run-example","seq":2,"event":{"type":"error","code":"agent_failed"}}\n\nevent: done\ndata: {"v":1,"runId":"run-example","seq":3}\n\n' } },
      "x-sse-events": { agent: ref("AgentEventFrame"), done: ref("DoneEventFrame"), heartbeat: { description: "SSE comment (: heartbeat)" } } },
      ...Object.fromEntries([400, 401, 403, 404, 415, 500, 503].map(status => [status, { description: "SSE開始前の拒否。", content: json(errorSchema(undefined, [status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : "request_failed"])) }])) } } };
  const spec = { openapi: "3.1.1", info: { title: "KAIHO HTTP API", version: "1.0.0",
    description: "既存SPAが利用するHTTP契約。TypeScriptの公開型とtransport制約から生成する。国制限は日本、旅行検索は設定済み32都府県。動的なowner認可・cross-field制約・Domain validatorはOpenAPIだけで置換しない。API Gatewayの前段拒否は独自のエラーbodyを返し得る。CloudFront内部API key/OACはBrowserへ公開しない。" },
    servers: [{ url: "/", description: "SPAと同じorigin。Gateway originへ直接接続しない。" }],
    tags: ["agent", "conversation", "profile", "trip", "sharing", "read", "browserDiagnostics"].map(name => ({ name })), security: [{ CognitoAccessToken: [] }], paths,
    "x-unpublished": { paths: [personalApiPolicies.notification.path, personalApiPolicies.inTrip.path], applications: ["ReservationApplication", "ChecklistApplication"], description: "通知/in-tripは公開Trip hostに接続されず404。独立factoryの501 gateやIAM-only workerは公開APIに含めない。静的Viewer/trafficデータ・認証設定・Cognito OAuth endpointは別契約。" },
    components: { securitySchemes: { CognitoAccessToken: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Cognito Access Token。ID Token不可。raiquora/user scopeが必要。" },
      CognitoReadToken: { type: "apiKey", in: "header", name: "X-Raiquora-Access-Token", description: "Bearer <Cognito Access Token>。OAC署名用Authorizationとは別。" } }, schemas } };
  // Drop helper aliases that are no longer referenced after command flattening.
  const needed = new Set();
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (value.$ref?.startsWith("#/components/schemas/")) {
      const name = value.$ref.slice("#/components/schemas/".length);
      if (!needed.has(name)) { needed.add(name); visit(schemas[name]); }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(paths);
  spec.components.schemas = Object.fromEntries(Object.entries(schemas).filter(([name]) => needed.has(name)));
  await SwaggerParser.validate(structuredClone(spec));
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addSchema({ $id: "urn:kaiho:openapi", components: spec.components });
  for (const name of Object.keys(model.properties)) ajv.compile({ $ref: `urn:kaiho:openapi#/components/schemas/${name}` });
  return spec;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const contents = `${JSON.stringify(await generateOpenApi(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== contents) throw new Error("OpenAPI is stale: run npm run api:generate");
    console.log("OpenAPI valid; generated schemas and public operation allowlists match.");
  } else { writeFileSync(output, contents); console.log(`Generated ${output}`); }
}
