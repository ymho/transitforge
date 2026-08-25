import type { Evidence } from "./evidence-model";
import type { AgentTraceRecorder } from "./agent-trace";
import type { AgentToolResult } from "./tool-contract";
import { AgentToolRegistry } from "./tool-registry";
import { ToolEvidenceRegistry } from "./tool-evidence-registry";

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

  async execute(
    input: {
      executionId: string;
      toolCallId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      timeoutMs: number;
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
    return {
      result,
      evidence: this.evidenceMappers.collect(input.toolName, result.output, {
        executionId: input.executionId,
        retrievedAt: this.now().toISOString(),
      }),
    };
  }
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
