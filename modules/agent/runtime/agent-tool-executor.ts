import type { Evidence } from "./evidence-model";
import type { AgentTraceRecorder } from "./agent-trace";
import type { AgentToolResult } from "./tool-contract";
import { AgentToolRegistry } from "./tool-registry";
import { ToolEvidenceRegistry } from "./tool-evidence-registry";
import type { IntentTarget } from "@raiquora/trip/conversation-intent";

export interface AgentToolExecution {
  result: AgentToolResult<unknown>;
  evidence: Evidence[];
}

export class AgentToolExecutor {
  constructor(
    private readonly tools: AgentToolRegistry,
    private readonly evidenceMappers: ToolEvidenceRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Application capability origin, independent of the model's no-fact declaration. */
  collectsEvidence(toolName: string): boolean { return this.evidenceMappers.has(toolName); }

  /** Application-registered effect; the model cannot downgrade a write/proposal to a read. */
  effect(toolName: string): "read" | "proposal" { return this.tools.effect(toolName); }

  async execute(
    input: {
      executionId: string;
      toolCallId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      timeoutMs: number;
      intentDependency?: { intentRevision: number; fingerprint: string; targets: IntentTarget[] };
    },
    trace: AgentTraceRecorder,
  ): Promise<AgentToolExecution> {
    trace.toolCalled(input.toolCallId, input.toolName, input.toolInput);
    const startedAt = this.now().getTime();
    const controller = new AbortController();
    const result = await withTimeout(
      this.tools.execute(input.toolName, input.toolInput, {
        executionId: input.executionId,
        signal: controller.signal,
        deadlineAt: startedAt + input.timeoutMs,
      }),
      input.timeoutMs,
      controller,
    );
    const latencyMs = Math.max(0, this.now().getTime() - startedAt);
    trace.toolCompleted(
      input.toolCallId,
      input.toolName,
      result,
      latencyMs,
    );
    if (!result.ok) return { result, evidence: [] };
    const evidence = this.evidenceMappers.collect(input.toolName, result.output, {
        executionId: input.executionId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        queryFingerprint: stableFingerprint(input.toolInput),
        retrievedAt: this.now().toISOString(),
      }).map((item) => input.intentDependency ? { ...item, intentDependency: structuredClone(input.intentDependency) } : item);
    return { result, evidence };
  }
}

/** Only independent read effects may run concurrently. Results retain input order. */
export async function executeBoundedAgentReads<T>(
  jobs: readonly (() => Promise<T>)[],
  maximumParallelReads: number,
  signal?: AbortSignal,
): Promise<T[]> {
  if (!Number.isSafeInteger(maximumParallelReads) || maximumParallelReads < 1 || maximumParallelReads > 8) {
    throw new Error("Invalid parallel read limit");
  }
  const results = new Array<T>(jobs.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      if (signal?.aborted) throw new DOMException("Read batch aborted", "AbortError");
      const index = next++;
      if (index >= jobs.length) return;
      results[index] = await jobs[index]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(maximumParallelReads, jobs.length) }, worker));
  return results;
}

/** Stable non-cryptographic identity. Inputs are already bounded by each Tool parser. */
function stableFingerprint(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortValue(input));
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `q-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortValue(item)]));
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T | AgentToolResult<never>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      resolve({
        ok: false,
        error: {
          code: "execution_failed",
          message: "Toolの実行時間が上限を超えました",
          retryable: true,
        },
      });
    }, Math.max(0, timeoutMs));
    void promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        error: {
          code: "execution_failed",
          message: "Toolを実行できませんでした",
          retryable: false,
        },
      });
    });
  });
}
