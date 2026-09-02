import type { Evidence } from "./evidence-model";
import type { AgentModelMetadata } from "./model-provider";
import type { AgentToolResult } from "./tool-contract";
import type {
  AgentKnownConstraint,
  AgentKnownPreference,
} from "./agent-decision-context";

export type AgentTraceStatus = "completed" | "failed" | "cancelled";

export interface TracePayloadSummary {
  byteLength: number;
  truncated: boolean;
  value: unknown;
}

export interface AgentDecisionTrace {
  interpretedGoal: string;
  hardConstraints: AgentKnownConstraint[];
  softPreferences: AgentKnownPreference[];
  selectedAction: "use_tool" | "ask_user" | "answer";
  selectedTool?: string;
  unresolvedFacts: string[];
  reasonCodes: string[];
  replanReason?: string;
}

interface AgentTraceEventBase {
  sequence: number;
  occurredAt: string;
}

export type AgentTraceEvent =
  | (AgentTraceEventBase & {
      type: "task_started";
      userRequest: string;
    })
  | (AgentTraceEventBase & {
      type: "intent_normalized";
      intent: string;
      constraints: TracePayloadSummary;
    })
  | (AgentTraceEventBase & {
      type: "plan_created";
      steps: string[];
    })
  | (AgentTraceEventBase & {
      type: "decision_recorded";
      interpretedGoal: string;
      hardConstraints: TracePayloadSummary;
      softPreferences: TracePayloadSummary;
      selectedAction: AgentDecisionTrace["selectedAction"];
      selectedTool?: string;
      unresolvedFacts: string[];
      reasonCodes: string[];
      replanReason?: string;
    })
  | (AgentTraceEventBase & {
      type: "tool_called";
      toolCallId: string;
      toolName: string;
      input: TracePayloadSummary;
    })
  | (AgentTraceEventBase & {
      type: "tool_completed";
      toolCallId: string;
      toolName: string;
      outcome: "success" | "error";
      result: TracePayloadSummary;
      latencyMs?: number;
      errorCode?: string;
      retryable?: boolean;
    })
  | (AgentTraceEventBase & {
      type: "evidence_collected";
      evidenceIds: string[];
      categories: string[];
      sourceTypes: string[];
    })
  | (AgentTraceEventBase & {
      type: "replan_decided";
      changed: boolean;
      reason: string;
      steps: string[];
    })
  | (AgentTraceEventBase & {
      type: "model_started";
      modelCallId: string;
      modelClass?: string;
      messageCount: number;
      toolNames: string[];
    })
  | (AgentTraceEventBase & {
      type: "model_failed";
      modelCallId: string;
      reason: string;
    })
  | (AgentTraceEventBase & {
      type: "model_completed";
      modelCallId?: string;
      provider: string;
      requestId?: string;
      model?: string;
      latencyMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    })
  | (AgentTraceEventBase & {
      type: "response_generated";
      response: string;
      claimIds: string[];
    })
  | (AgentTraceEventBase & {
      type: "viewer_action";
      actionType: string;
      status: "proposed" | "applied" | "rejected";
      targetEntityId?: string;
      reason?: string;
    })
  | (AgentTraceEventBase & {
      type: "task_completed";
      status: AgentTraceStatus;
      latencyMs?: number;
      reason?: string;
    });

type AgentTraceEventInput = {
  [Type in AgentTraceEvent["type"]]: Omit<
    Extract<AgentTraceEvent, { type: Type }>,
    "sequence" | "occurredAt"
  >;
}[AgentTraceEvent["type"]];

export interface AgentTrace {
  executionId: string;
  events: AgentTraceEvent[];
  droppedEventCount: number;
}

export interface AgentTraceRecorderOptions {
  maxEvents?: number;
  maxPayloadCharacters?: number;
  maxStringCharacters?: number;
  maxArrayItems?: number;
  maxDepth?: number;
  now?: () => Date;
}

interface TraceSanitizationOptions {
  maxPayloadCharacters: number;
  maxStringCharacters: number;
  maxArrayItems: number;
  maxDepth: number;
}

const SECRET_KEY = /(?:authorization|cookie|password|secret|token|api[_-]?key|credential)/iu;
const LOCATION_KEY = /^(?:lat|latitude|lng|lon|longitude|coordinates?|currentLocation)$/iu;
const BEARER_VALUE = /bearer\s+[a-z0-9._~+/=-]+/giu;
const KEY_VALUE_SECRET = /((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/giu;

export class AgentTraceRecorder {
  private readonly events: AgentTraceEvent[] = [];
  private readonly options: Required<AgentTraceRecorderOptions>;
  private nextSequence = 1;
  private droppedEventCount = 0;

  constructor(
    readonly executionId: string,
    options: AgentTraceRecorderOptions = {},
  ) {
    this.options = {
      maxEvents: options.maxEvents ?? 200,
      maxPayloadCharacters: options.maxPayloadCharacters ?? 2_048,
      maxStringCharacters: options.maxStringCharacters ?? 512,
      maxArrayItems: options.maxArrayItems ?? 20,
      maxDepth: options.maxDepth ?? 5,
      now: options.now ?? (() => new Date()),
    };
    if (!executionId || this.options.maxEvents < 1) {
      throw new Error("TraceにはexecutionIdと1件以上のevent上限が必要です");
    }
  }

  taskStarted(userRequest: string): void {
    this.append({ type: "task_started", userRequest: this.text(userRequest) });
  }

  intentNormalized(intent: string, constraints: unknown = {}): void {
    this.append({
      type: "intent_normalized",
      intent: this.text(intent),
      constraints: this.payload(constraints),
    });
  }

  planCreated(steps: string[]): void {
    this.append({ type: "plan_created", steps: this.texts(steps) });
  }

  decisionRecorded(decision: AgentDecisionTrace): void {
    this.append({
      type: "decision_recorded",
      interpretedGoal: this.text(decision.interpretedGoal),
      hardConstraints: this.payload(decision.hardConstraints.slice(0, 8)),
      softPreferences: this.payload(decision.softPreferences.slice(0, 8)),
      selectedAction: decision.selectedAction,
      ...(decision.selectedTool ? { selectedTool: this.text(decision.selectedTool) } : {}),
      unresolvedFacts: this.texts(decision.unresolvedFacts),
      reasonCodes: this.texts(decision.reasonCodes),
      ...(decision.replanReason ? { replanReason: this.text(decision.replanReason) } : {}),
    });
  }

  toolCalled(toolCallId: string, toolName: string, input: unknown): void {
    this.append({
      type: "tool_called",
      toolCallId: this.text(toolCallId),
      toolName: this.text(toolName),
      input: this.payload(input),
    });
  }

  toolCompleted(
    toolCallId: string,
    toolName: string,
    result: AgentToolResult<unknown>,
    latencyMs?: number,
  ): void {
    if (result.ok) {
      this.append({
        type: "tool_completed",
        toolCallId: this.text(toolCallId),
        toolName: this.text(toolName),
        outcome: "success",
        result: this.payload(result.output),
        ...(validLatency(latencyMs) ? { latencyMs } : {}),
      });
      return;
    }
    this.append({
      type: "tool_completed",
      toolCallId: this.text(toolCallId),
      toolName: this.text(toolName),
      outcome: "error",
      result: this.payload({ message: result.error.message }),
      errorCode: result.error.code,
      retryable: result.error.retryable,
      ...(validLatency(latencyMs) ? { latencyMs } : {}),
    });
  }

  evidenceCollected(evidence: Evidence[]): void {
    this.append({
      type: "evidence_collected",
      evidenceIds: unique(evidence.map(({ id }) => this.text(id))),
      categories: unique(evidence.map(({ category }) => category)),
      sourceTypes: unique(evidence.flatMap(({ references }) =>
        references.map(({ sourceType }) => sourceType))),
    });
  }

  replanDecided(changed: boolean, reason: string, steps: string[] = []): void {
    this.append({
      type: "replan_decided",
      changed,
      reason: this.text(reason),
      steps: this.texts(steps),
    });
  }

  modelStarted(
    modelCallId: string,
    input: { modelClass?: string; messageCount: number; toolNames: string[] },
  ): void {
    this.append({
      type: "model_started",
      modelCallId: this.text(modelCallId),
      ...(input.modelClass ? { modelClass: this.text(input.modelClass) } : {}),
      messageCount: input.messageCount,
      toolNames: unique(this.texts(input.toolNames)),
    });
  }

  modelFailed(modelCallId: string, reason: string): void {
    this.append({
      type: "model_failed",
      modelCallId: this.text(modelCallId),
      reason: this.text(reason),
    });
  }

  modelCompleted(metadata: AgentModelMetadata, modelCallId?: string): void {
    this.append({
      type: "model_completed",
      ...(modelCallId ? { modelCallId: this.text(modelCallId) } : {}),
      provider: this.text(metadata.provider),
      ...(metadata.requestId ? { requestId: this.text(metadata.requestId) } : {}),
      ...(metadata.model ? { model: this.text(metadata.model) } : {}),
      ...(validLatency(metadata.latencyMs) ? { latencyMs: metadata.latencyMs } : {}),
      ...(validCount(metadata.usage?.inputTokens)
        ? { inputTokens: metadata.usage.inputTokens }
        : {}),
      ...(validCount(metadata.usage?.outputTokens)
        ? { outputTokens: metadata.usage.outputTokens }
        : {}),
      ...(validCount(metadata.usage?.totalTokens)
        ? { totalTokens: metadata.usage.totalTokens }
        : {}),
    });
  }

  responseGenerated(response: string, claimIds: string[] = []): void {
    this.append({
      type: "response_generated",
      response: this.text(response),
      claimIds: unique(this.texts(claimIds)),
    });
  }

  viewerAction(
    actionType: string,
    status: "proposed" | "applied" | "rejected",
    details: { targetEntityId?: string; reason?: string } = {},
  ): void {
    this.append({
      type: "viewer_action",
      actionType: this.text(actionType),
      status,
      ...(details.targetEntityId
        ? { targetEntityId: this.text(details.targetEntityId) }
        : {}),
      ...(details.reason ? { reason: this.text(details.reason) } : {}),
    });
  }

  taskCompleted(status: AgentTraceStatus, latencyMs?: number, reason?: string): void {
    this.append({
      type: "task_completed",
      status,
      ...(validLatency(latencyMs) ? { latencyMs } : {}),
      ...(reason ? { reason: this.text(reason) } : {}),
    });
  }

  snapshot(): AgentTrace {
    return {
      executionId: this.executionId,
      events: structuredClone(this.events),
      droppedEventCount: this.droppedEventCount,
    };
  }

  private append(event: AgentTraceEventInput): void {
    if (this.events.length >= this.options.maxEvents) {
      this.droppedEventCount += 1;
      return;
    }
    this.events.push({
      ...event,
      sequence: this.nextSequence,
      occurredAt: this.options.now().toISOString(),
    } as AgentTraceEvent);
    this.nextSequence += 1;
  }

  private payload(value: unknown): TracePayloadSummary {
    return summarizeTracePayload(value, this.options);
  }

  private text(value: string): string {
    return sanitizeText(value, this.options.maxStringCharacters);
  }

  private texts(values: string[]): string[] {
    return values.slice(0, this.options.maxArrayItems).map((value) => this.text(value));
  }
}

export function summarizeTracePayload(
  value: unknown,
  options: Partial<TraceSanitizationOptions> = {},
): TracePayloadSummary {
  const settings: TraceSanitizationOptions = {
    maxPayloadCharacters: options.maxPayloadCharacters ?? 2_048,
    maxStringCharacters: options.maxStringCharacters ?? 512,
    maxArrayItems: options.maxArrayItems ?? 20,
    maxDepth: options.maxDepth ?? 5,
  };
  const byteLength = new TextEncoder().encode(safeStringify(value)).byteLength;
  const sanitized = sanitizeValue(value, settings, 0);
  const serialized = safeStringify(sanitized);
  if (serialized.length <= settings.maxPayloadCharacters) {
    return { byteLength, truncated: serialized !== safeStringify(value), value: sanitized };
  }
  return {
    byteLength,
    truncated: true,
    value: isRecord(sanitized)
      ? { keys: Object.keys(sanitized).slice(0, settings.maxArrayItems) }
      : { type: payloadType(sanitized) },
  };
}

function sanitizeValue(
  value: unknown,
  options: TraceSanitizationOptions,
  depth: number,
): unknown {
  if (depth >= options.maxDepth) return "[depth-limited]";
  if (typeof value === "string") return sanitizeText(value, options.maxStringCharacters);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, options.maxArrayItems)
      .map((item) => sanitizeValue(item, options, depth + 1));
    if (value.length > options.maxArrayItems) items.push("[items-limited]");
    return items;
  }
  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, options.maxArrayItems)) {
      if (SECRET_KEY.test(key)) sanitized[key] = "[redacted]";
      else if (LOCATION_KEY.test(key)) sanitized[key] = "[location-redacted]";
      else sanitized[key] = sanitizeValue(nested, options, depth + 1);
    }
    return sanitized;
  }
  return `[${typeof value}]`;
}

function sanitizeText(value: string, maxCharacters: number): string {
  const redacted = value
    .replace(BEARER_VALUE, "Bearer [redacted]")
    .replace(KEY_VALUE_SECRET, "$1[redacted]");
  return redacted.length <= maxCharacters
    ? redacted
    : `${redacted.slice(0, maxCharacters)}…`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

function payloadType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function validLatency(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function validCount(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0;
}
