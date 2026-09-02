import { createHash } from "node:crypto";

import type { JsonObject } from "../contracts/agent-request.js";
import type {
  ModelCallTraceRecord,
  ModelCallTraceRecorder,
} from "../ports/model-call-trace.js";
import type { PrivateObjectStorage } from "../ports/private-object-storage.js";

const maximumPayloadBytes = 3 * 1_024 * 1_024;
const maximumDepth = 20;
const secretKeyPattern = /^(?:authorization|cookie|password|secret|token|accessToken|refreshToken|api[_-]?key|credential)s?$/iu;
const locationKeyPattern = /^(?:lat|latitude|lng|lon|longitude|coordinates?|currentLocation)$/iu;
const bearerPattern = /bearer\s+[a-z0-9._~+/=-]+/giu;
const keyValueSecretPattern = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\s*[:=]\s*)[^\s,;]+/giu;
const coordinatePairPattern = /(?<!\d)-?\d{1,2}\.\d+\s*[,/]\s*-?\d{1,3}\.\d+(?!\d)/gu;
const labeledCoordinatePattern = /(?:緯度|経度|latitude|longitude)\s*[:=]?\s*-?\d{1,3}(?:\.\d+)?/giu;

export interface StoredModelCallTraceOptions {
  bucket: string;
  storage: PrivateObjectStorage;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export class StoredModelCallTraceRecorder implements ModelCallTraceRecorder {
  private readonly log: (event: string, fields: Record<string, unknown>) => void;

  constructor(private readonly options: StoredModelCallTraceOptions) {
    this.log = options.log ?? (() => undefined);
  }

  async record(value: ModelCallTraceRecord): Promise<void> {
    const sanitized = sanitizeValue(value, 0) as JsonObject;
    const fullPayload = {
      schemaVersion: "agent-model-call-trace-v1",
      ...sanitized,
    };
    const fullBody = JSON.stringify(fullPayload);
    const fullBytes = new TextEncoder().encode(fullBody);
    const payload = fullBytes.byteLength <= maximumPayloadBytes
      ? fullPayload
      : {
          schemaVersion: "agent-model-call-trace-v1",
          modelCallId: value.modelCallId,
          apiRequestId: value.apiRequestId,
          startedAt: value.startedAt,
          completedAt: value.completedAt,
          providerRequest: {
            truncated: true,
            byteLength: fullBytes.byteLength,
            sha256: createHash("sha256").update(fullBody).digest("hex"),
          },
          outcome: sanitizeValue(value.outcome, 0),
        };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const date = value.startedAt.slice(0, 10).replaceAll("-", "/");
    await this.options.storage.put({
      bucket: this.options.bucket,
      key: `agent-traces/model-calls/${date}/${value.modelCallId}/${value.apiRequestId}.json`,
      body,
      contentType: "application/json",
      encryption: "AES256",
    });
    this.log("agent_model_call_trace_stored", {
      modelCallId: value.modelCallId,
      requestId: value.apiRequestId,
      outcome: value.outcome.status,
      byteLength: body.byteLength,
      truncated: fullBytes.byteLength > maximumPayloadBytes,
    });
  }
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth >= maximumDepth) return "[depth-limited]";
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      secretKeyPattern.test(key)
        ? "[redacted]"
        : locationKeyPattern.test(key)
          ? "[location-redacted]"
          : sanitizeValue(nested, depth + 1),
    ]));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
