import { randomUUID } from "node:crypto";

import { type JsonObject, RequestError } from "../contracts/agent-request.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { PrivateObjectStorage } from "../ports/private-object-storage.js";

const maximumEvents = 100;
const maximumPayloadBytes = 24 * 1_024;
const maximumRequestIds = 10;
const maximumTextCharacters = 512;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const secretKeyPattern = /(?:authorization|cookie|password|secret|token|api[_-]?key|credential)/iu;
const locationKeyPattern = /^(?:lat|latitude|lng|lon|longitude|coordinates?|currentLocation)$/iu;
const bearerPattern = /bearer\s+[a-z0-9._~+/=-]+/giu;
const keyValueSecretPattern = /((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/giu;
const coordinatePairPattern = /(?<!\d)-?\d{1,2}\.\d+\s*[,/]\s*-?\d{1,3}\.\d+(?!\d)/gu;
const labeledCoordinatePattern = /(?:緯度|経度|latitude|longitude)\s*[:=]?\s*-?\d{1,3}(?:\.\d+)?/giu;

const eventFields = {
  task_started: [["userRequest"], []],
  intent_normalized: [["intent", "constraints"], []],
  plan_created: [["steps"], []],
  decision_recorded: [["interpretedGoal", "hardConstraints", "softPreferences", "selectedAction", "unresolvedFacts", "reasonCodes"], ["selectedTool", "replanReason"]],
  tool_called: [["toolCallId", "toolName", "input"], []],
  tool_completed: [["toolCallId", "toolName", "outcome", "result"], ["latencyMs", "errorCode", "retryable"]],
  evidence_collected: [["evidenceIds", "categories", "sourceTypes"], []],
  replan_decided: [["changed", "reason", "steps"], []],
  model_completed: [["provider"], ["requestId", "model", "latencyMs", "inputTokens", "outputTokens", "totalTokens"]],
  response_generated: [["response", "claimIds"], []],
  viewer_action: [["actionType", "status"], ["targetEntityId", "reason"]],
  task_completed: [["status"], ["latencyMs", "reason"]],
} as const;

const stringFields = new Set(["userRequest", "intent", "interpretedGoal", "selectedTool", "replanReason", "toolCallId", "toolName", "errorCode", "provider", "requestId", "model", "reason", "response", "actionType", "targetEntityId"]);
const stringListFields = new Set(["steps", "unresolvedFacts", "reasonCodes", "evidenceIds", "categories", "sourceTypes", "claimIds"]);
const countFields = new Set(["sequence", "latencyMs", "inputTokens", "outputTokens", "totalTokens"]);
const payloadFields = new Set(["constraints", "hardConstraints", "softPreferences", "input", "result"]);

export interface TraceOperationOptions {
  bucket: string;
  storage: PrivateObjectStorage;
  now?: () => Date;
  createId?: () => string;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export function createAgentTraceOperation(options: TraceOperationOptions): AgentOperation {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const log = options.log ?? (() => undefined);
  return async (request, context) => {
    const startedAt = performance.now();
    try {
      const result = await storeAgentTrace(request, options, now(), createId());
      log("agent_trace_stored", {
        requestId: context.requestId,
        traceId: result.traceId,
        taskId: request.taskId,
        eventCount: result.eventCount,
        relatedRequestCount: Array.isArray(request.requestIds) ? request.requestIds.length : 0,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { body: result };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      log("agent_trace_store_failed", {
        requestId: context.requestId,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { statusCode: 503, body: { message: "Agent Traceを保存できませんでした。" } };
    }
  };
}

export async function storeAgentTrace(
  value: JsonObject,
  options: Pick<TraceOperationOptions, "bucket" | "storage">,
  now: Date,
  traceId: string,
): Promise<{ traceId: string; eventCount: number }> {
  if (!options.bucket) throw new RequestError(503, "Agent Trace保存先を利用できません。");
  const allowed = new Set(["operation", "taskId", "requestIds", "trace"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new RequestError(400, "Agent Trace送信fieldが不正です。");
  }
  if (value.operation !== undefined && value.operation !== "agent_trace") {
    throw new RequestError(400, "Agent Trace operationが不正です。");
  }
  const taskId = identifier(value.taskId, "taskId");
  const requestIds = validatedRequestIds(value.requestIds ?? []);
  const trace = validatedTrace(value.trace);
  const payload = {
    schemaVersion: "agent-trace-submission-v1",
    traceId,
    taskId,
    executionId: trace.executionId,
    createdAt: now.toISOString().replace(".000Z", "+00:00"),
    requestIds,
    trace,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  if (encoded.byteLength > maximumPayloadBytes) {
    throw new RequestError(413, "Agent Traceが大きすぎます。");
  }
  await options.storage.put({
    bucket: options.bucket,
    key: `agent-traces/${now.toISOString().slice(0, 10).replaceAll("-", "/")}/${taskId}/${traceId}.json`,
    body: encoded,
    contentType: "application/json",
    encryption: "AES256",
  });
  return { traceId, eventCount: trace.events.length };
}

function validatedTrace(value: unknown): { executionId: string; events: JsonObject[]; droppedEventCount: number } {
  if (!isRecord(value) || !sameKeys(value, ["executionId", "events", "droppedEventCount"])) {
    throw new RequestError(400, "Agent Traceの形式が不正です。");
  }
  const executionId = identifier(value.executionId, "executionId");
  if (!Number.isInteger(value.droppedEventCount) || (value.droppedEventCount as number) < 0) {
    throw new RequestError(400, "droppedEventCountが不正です。");
  }
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > maximumEvents) {
    throw new RequestError(400, "Agent Trace eventの件数が不正です。");
  }
  const events = value.events.map((event, index) => validatedEvent(event, index + 1));
  let previous = 0;
  for (const event of events) {
    if ((event.sequence as number) <= previous) {
      throw new RequestError(400, "Agent Trace eventの順序が不正です。");
    }
    previous = event.sequence as number;
  }
  return { executionId, events, droppedEventCount: value.droppedEventCount as number };
}

function validatedEvent(value: unknown, position: number): JsonObject {
  if (!isRecord(value)) throw new RequestError(400, `Agent Trace event ${position}件目が不正です。`);
  const eventType = typeof value.type === "string" && value.type in eventFields
    ? value.type as keyof typeof eventFields
    : undefined;
  if (!eventType) throw new RequestError(400, `Agent Trace event ${position}件目のtypeが不正です。`);
  const [required, optional] = eventFields[eventType];
  const allowed = new Set<string>(["type", "sequence", "occurredAt", ...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key)) || required.some((key) => !(key in value))) {
    throw new RequestError(400, `Agent Trace event ${position}件目のfieldが不正です。`);
  }
  if (!Number.isInteger(value.sequence) || (value.sequence as number) < 1 || !validTimestamp(value.occurredAt)) {
    throw new RequestError(400, `Agent Trace event ${position}件目の共通fieldが不正です。`);
  }
  const result: JsonObject = { type: eventType, sequence: value.sequence, occurredAt: value.occurredAt };
  for (const key of [...required, ...optional]) {
    if (key in value) result[key] = validatedEventField(key, value[key], eventType, position);
  }
  return result;
}

function validatedEventField(key: string, value: unknown, eventType: string, position: number): unknown {
  const invalid = () => new RequestError(400, `Agent Trace event ${position}件目の${key}が不正です。`);
  if (stringFields.has(key)) {
    if (typeof value !== "string" || !value || value.length > maximumTextCharacters) throw invalid();
    return sanitizeString(value);
  }
  if (stringListFields.has(key)) {
    if (!Array.isArray(value) || value.length > 20 || !value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 160)) throw invalid();
    return value.map(sanitizeString);
  }
  if (countFields.has(key)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw invalid();
    return value;
  }
  if (payloadFields.has(key)) return validatedPayload(value, position);
  if (key === "changed" || key === "retryable") {
    if (typeof value !== "boolean") throw invalid();
    return value;
  }
  if (key === "outcome" && (value === "success" || value === "error")) return value;
  if (key === "selectedAction" && (value === "use_tool" || value === "ask_user" || value === "answer")) return value;
  if (key === "status") {
    const allowed = eventType === "viewer_action"
      ? new Set(["proposed", "applied", "rejected"])
      : new Set(["completed", "failed", "cancelled"]);
    if (allowed.has(value as string)) return value;
  }
  throw invalid();
}

function validatedPayload(value: unknown, position: number): JsonObject {
  const invalid = () => new RequestError(400, `Agent Trace event ${position}件目のpayloadが不正です。`);
  if (!isRecord(value) || !sameKeys(value, ["byteLength", "truncated", "value"]) ||
    !Number.isInteger(value.byteLength) || (value.byteLength as number) < 0 || typeof value.truncated !== "boolean") {
    throw invalid();
  }
  return { byteLength: value.byteLength, truncated: value.truncated, value: sanitizeValue(value.value, 0) };
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth >= 5) return "[depth-limited]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return sanitizeString(value.slice(0, maximumTextCharacters));
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([rawKey, nested]) => {
      const key = rawKey.slice(0, 80);
      return [key, secretKeyPattern.test(key)
        ? "[redacted]"
        : locationKeyPattern.test(key)
          ? "[location-redacted]"
          : sanitizeValue(nested, depth + 1)];
    }));
  }
  return `[${typeof value}]`;
}

function sanitizeString(value: string): string {
  return value
    .replace(bearerPattern, "Bearer [redacted]")
    .replace(keyValueSecretPattern, "$1[redacted]")
    .replace(coordinatePairPattern, "[location-redacted]")
    .replace(labeledCoordinatePattern, "[location-redacted]");
}

function validatedRequestIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > maximumRequestIds ||
    !value.every((item) => typeof item === "string" && identifierPattern.test(item)) ||
    new Set(value).size !== value.length) {
    throw new RequestError(400, "requestIdsの形式が不正です。");
  }
  return value;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw new RequestError(400, `${name}の形式が不正です。`);
  }
  return value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && !Number.isNaN(Date.parse(value));
}

function sameKeys(value: JsonObject, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
