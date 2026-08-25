import { AgentTraceRecorder } from "./agent-trace";
import type { AgentModelContent, AgentModelMessage, AgentModelProvider } from "./model-provider";
import { DefaultAgentProblemFramer, type AgentProblemFramer } from "./problem-framing";
import { DefaultAgentPlanner, type AgentPlanner } from "./agent-planner";
import {
  DefaultAgentResponseGenerator,
  type AgentResponseGenerator,
} from "./agent-response-generator";
import { AgentToolExecutor } from "./agent-tool-executor";
import type { Evidence } from "./evidence-model";
import {
  validateAgentRuntimeLimits,
  type AgentRuntimeLimits,
} from "./runtime-policies";
import type { AgentRuntimeRequest, AgentRuntimeResult } from "./runtime-contract";
import { AgentToolRegistry } from "./tool-registry";

export interface AgentRuntimeDependencies {
  model: AgentModelProvider;
  tools: AgentToolRegistry;
  toolExecutor: AgentToolExecutor;
  problemFramer?: AgentProblemFramer;
  planner?: AgentPlanner;
  responseGenerator?: AgentResponseGenerator;
  limits?: Partial<AgentRuntimeLimits>;
  now?: () => Date;
}

export class MultiStepAgentRuntime {
  private readonly problemFramer: AgentProblemFramer;
  private readonly planner: AgentPlanner;
  private readonly responseGenerator: AgentResponseGenerator;
  private readonly limits: AgentRuntimeLimits;
  private readonly now: () => Date;

  constructor(private readonly dependencies: AgentRuntimeDependencies) {
    this.problemFramer = dependencies.problemFramer ?? new DefaultAgentProblemFramer();
    this.planner = dependencies.planner ?? new DefaultAgentPlanner();
    this.responseGenerator = dependencies.responseGenerator ??
      new DefaultAgentResponseGenerator();
    this.limits = validateAgentRuntimeLimits(dependencies.limits);
    this.now = dependencies.now ?? (() => new Date());
  }

  async run(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    const startedAt = this.now().getTime();
    const deadline = startedAt + this.limits.maxExecutionMs;
    const trace = new AgentTraceRecorder(request.executionId, { now: this.now });
    const evidence: Evidence[] = [];
    trace.taskStarted(request.userRequest);

    const problem = this.problemFramer.frame(request);
    trace.intentNormalized(problem.normalizedIntent, problem.constraints);
    const plan = this.planner.createPlan(problem, this.dependencies.tools.descriptors());
    trace.planCreated(plan.steps);

    if (problem.missingInformation.length > 0) {
      const response = this.responseGenerator.followUp(problem);
      trace.responseGenerated(response);
      trace.taskCompleted("completed", elapsed(startedAt, this.now));
      return result("follow_up", response, evidence, trace);
    }

    const messages: AgentModelMessage[] = [{
      role: "user",
      content: [{ type: "text", text: problem.objective }],
    }];
    let modelCalls = 0;
    let toolCalls = 0;
    let iterations = 0;

    while (true) {
      if (
        iterations >= this.limits.maxIterations ||
        modelCalls >= this.limits.maxModelCalls ||
        this.now().getTime() >= deadline
      ) {
        return this.limitResult(trace, evidence, startedAt);
      }

      const remainingMs = Math.max(1, deadline - this.now().getTime());
      const modelOutcome = await modelBeforeDeadline(
        this.dependencies.model.generate({
          messages,
          tools: this.dependencies.tools.descriptors(),
        }),
        remainingMs,
      );
      if (modelOutcome.kind === "timeout") {
        return this.limitResult(trace, evidence, startedAt);
      }
      if (modelOutcome.kind === "error") {
        return this.failureResult(trace, evidence, startedAt, "model_call_failed");
      }
      const modelResponse = modelOutcome.value;
      modelCalls += 1;
      trace.modelCompleted(modelResponse.metadata);
      messages.push(modelResponse.message);

      if (modelResponse.stopReason === "max_tokens") {
        return this.limitResult(trace, evidence, startedAt);
      }

      const calls = modelResponse.message.content.filter(
        (content): content is Extract<AgentModelContent, { type: "tool_call" }> =>
          content.type === "tool_call",
      );
      if (modelResponse.stopReason === "tool_calls" && calls.length === 0) {
        return this.failureResult(trace, evidence, startedAt, "missing_tool_call");
      }
      if (modelResponse.stopReason !== "tool_calls") {
        const response = this.responseGenerator.fromModel(modelResponse, evidence);
        trace.responseGenerated(response);
        trace.taskCompleted("completed", elapsed(startedAt, this.now));
        return result("completed", response, evidence, trace);
      }
      if (toolCalls + calls.length > this.limits.maxToolCalls) {
        return this.limitResult(trace, evidence, startedAt);
      }

      const toolResults: AgentModelContent[] = [];
      for (const call of calls) {
        const execution = await this.dependencies.toolExecutor.execute({
          executionId: request.executionId,
          toolCallId: call.toolCallId,
          toolName: call.name,
          toolInput: call.input,
          timeoutMs: Math.max(1, deadline - this.now().getTime()),
        }, trace);
        toolCalls += 1;
        const availableSlots = this.limits.maxEvidence - evidence.length;
        if (execution.evidence.length > 0 && availableSlots > 0) {
          const existingEvidenceIds = new Set(evidence.map(({ id }) => id));
          const collected = execution.evidence
            .filter(({ id }) => !existingEvidenceIds.has(id))
            .slice(0, availableSlots);
          evidence.push(...collected);
          if (collected.length > 0) trace.evidenceCollected(collected);
        }
        toolResults.push({
          type: "tool_result",
          toolCallId: call.toolCallId,
          status: execution.result.ok ? "success" : "error",
          output: execution.result.ok
            ? execution.result.output
            : { error: execution.result.error },
        });
      }
      messages.push({ role: "user", content: toolResults });
      iterations += 1;
      trace.replanDecided(true, "Tool結果を受けて次の手順を判断する", plan.steps);
    }
  }

  private limitResult(
    trace: AgentTraceRecorder,
    evidence: Evidence[],
    startedAt: number,
  ): AgentRuntimeResult {
    const response = this.responseGenerator.limitReached();
    trace.responseGenerated(response);
    trace.taskCompleted("failed", elapsed(startedAt, this.now), "runtime_limit_reached");
    return result("limit_reached", response, evidence, trace);
  }

  private failureResult(
    trace: AgentTraceRecorder,
    evidence: Evidence[],
    startedAt: number,
    reason: string,
  ): AgentRuntimeResult {
    const response = this.responseGenerator.failure();
    trace.responseGenerated(response);
    trace.taskCompleted("failed", elapsed(startedAt, this.now), reason);
    return result("failed", response, evidence, trace);
  }
}

function result(
  status: AgentRuntimeResult["status"],
  response: string,
  evidence: Evidence[],
  trace: AgentTraceRecorder,
): AgentRuntimeResult {
  return {
    status,
    response,
    evidence: [...evidence],
    trace: trace.snapshot(),
  };
}

function elapsed(startedAt: number, now: () => Date): number {
  return Math.max(0, now().getTime() - startedAt);
}

type ModelDeadlineResult<T> =
  | { kind: "success"; value: T }
  | { kind: "timeout" }
  | { kind: "error" };

function modelBeforeDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<ModelDeadlineResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "timeout" });
    }, Math.max(0, timeoutMs));
    void promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ kind: "success", value });
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ kind: "error" });
    });
  });
}
