import { AgentTraceRecorder } from "./agent-trace";
import type {
  AgentModelContent,
  AgentModelClass,
  AgentModelMessage,
  AgentModelProvider,
  AgentModelResponse,
} from "./model-provider";
import { DefaultAgentProblemFramer, type AgentProblemFramer } from "./problem-framing";
import { DefaultAgentPlanner, type AgentPlanner } from "./agent-planner";
import {
  DefaultAgentResponseGenerator,
  hasOnlyInternalReasoning,
  type AgentResponseGenerator,
} from "./agent-response-generator";
import { AgentToolExecutor } from "./agent-tool-executor";
import {
  validateEvidenceAndClaims,
  type AssessedEvidenceClaim,
  type Evidence,
} from "./evidence-model";
import {
  validateAgentRuntimeLimits,
  type AgentRuntimeLimits,
} from "./runtime-policies";
import type { AgentRuntimeRequest, AgentRuntimeResult } from "./runtime-contract";
import type { AgentDecisionSummary } from "./agent-decision-summary";
import type { AgentDecisionTrace } from "./agent-trace";
import { AgentToolRegistry } from "./tool-registry";
import type { AgentViewerActionHandler } from "./viewer-action-handler";
import type { AgentViewerActionOutcome } from "./runtime-contract";
import { ToolViewerActionRegistry } from "./tool-viewer-action-registry";

export interface AgentRuntimeDependencies {
  model: AgentModelProvider;
  /** Evaluationまたは明示設定用。本番は未指定の単一modelを維持する。 */
  modelClass?: AgentModelClass;
  tools: AgentToolRegistry;
  toolExecutor: AgentToolExecutor;
  problemFramer?: AgentProblemFramer;
  planner?: AgentPlanner;
  responseGenerator?: AgentResponseGenerator;
  viewerActionHandler?: AgentViewerActionHandler;
  toolViewerActions?: ToolViewerActionRegistry;
  terminalToolResult?: (toolName: string, output: unknown) => string | undefined;
  finalResponsePolicy?: (
    response: AgentModelResponse,
    request: AgentRuntimeRequest,
  ) => { accepted: boolean; reason?: string; instruction?: string };
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

    const availableTools = this.dependencies.tools.descriptors();
    const problem = this.problemFramer.frame(request, availableTools);
    trace.intentNormalized(problem.normalizedIntent, problem.constraints);
    const plan = this.planner.createPlan(problem, availableTools);
    trace.planCreated(plan.steps);

    if (problem.missingInformation.length > 0) {
      const response = this.responseGenerator.followUp(problem);
      trace.responseGenerated(response);
      trace.taskCompleted("completed", elapsed(startedAt, this.now));
      return result("follow_up", response, evidence, [], [], trace);
    }

    const messages: AgentModelMessage[] = [{
      role: "user",
      content: [{ type: "text", text: problem.objective }],
    }];
    let modelCalls = 0;
    let toolCalls = 0;
    let iterations = 0;
    const toolViewerActionOutcomes: AgentViewerActionOutcome[] = [];

    while (true) {
      if (
        iterations >= this.limits.maxIterations ||
        modelCalls >= this.limits.maxModelCalls ||
        this.now().getTime() >= deadline
      ) {
        return this.limitResult(trace, evidence, toolViewerActionOutcomes, startedAt);
      }

      const remainingMs = Math.max(1, deadline - this.now().getTime());
      const modelOutcome = await modelBeforeDeadline(
        this.dependencies.model.generate({
          messages,
          tools: this.dependencies.tools.descriptors(),
          ...(this.dependencies.modelClass === undefined
            ? {}
            : { modelClass: this.dependencies.modelClass }),
        }),
        remainingMs,
      );
      if (modelOutcome.kind === "timeout") {
        return this.limitResult(trace, evidence, toolViewerActionOutcomes, startedAt);
      }
      if (modelOutcome.kind === "error") {
        return this.failureResult(trace, evidence, toolViewerActionOutcomes, startedAt, "model_call_failed");
      }
      const modelResponse = modelOutcome.value;
      modelCalls += 1;
      trace.modelCompleted(modelResponse.metadata);
      messages.push(modelResponse.message);

      if (modelResponse.stopReason === "max_tokens") {
        return this.limitResult(trace, evidence, toolViewerActionOutcomes, startedAt);
      }

      const calls = modelResponse.message.content.filter(
        (content): content is Extract<AgentModelContent, { type: "tool_call" }> =>
          content.type === "tool_call",
      );
      if (calls.length > 0) {
        for (const call of calls) {
          trace.decisionRecorded(decisionForToolCall(
            modelResponse,
            call.name,
            problem.decisionContext.userRequest,
            problem.decisionContext.knownHardConstraints,
            problem.decisionContext.knownSoftPreferences,
            iterations,
          ));
        }
      }
      if (modelResponse.stopReason === "tool_calls" && calls.length === 0) {
        return this.failureResult(trace, evidence, toolViewerActionOutcomes, startedAt, "missing_tool_call");
      }
      if (modelResponse.stopReason !== "tool_calls") {
        if (hasOnlyInternalReasoning(modelResponse)) {
          messages.push({
            role: "user",
            content: [{
              type: "text",
              text: "内部推論は表示せず 必要なToolを実行するか 利用者向けの質問または回答だけを返してください",
            }],
          });
          iterations += 1;
          trace.replanDecided(
            true,
            "内部推論だけの応答を破棄して利用者向け応答を再要求する",
            plan.steps,
          );
          continue;
        }
        const finalResponseDecision = this.dependencies.finalResponsePolicy?.(
          modelResponse,
          request,
        );
        if (finalResponseDecision && !finalResponseDecision.accepted) {
          trace.decisionRecorded({
            interpretedGoal: problem.decisionContext.userRequest,
            hardConstraints: problem.decisionContext.knownHardConstraints,
            softPreferences: problem.decisionContext.knownSoftPreferences,
            selectedAction: "answer",
            unresolvedFacts: [],
            reasonCodes: ["deterministic_policy_rejected_answer"],
            replanReason: finalResponseDecision.reason ?? "grounding_required",
          });
          messages.push({
            role: "user",
            content: [{
              type: "text",
              text: finalResponseDecision.instruction ??
                "必要なToolで事実を確認してから利用者へ回答してください",
            }],
          });
          iterations += 1;
          trace.replanDecided(
            true,
            finalResponseDecision.reason ?? "最終回答に必要な事実をToolで確認する",
            plan.steps,
          );
          continue;
        }
        let generated;
        try {
          generated = this.responseGenerator.fromModel(modelResponse, evidence);
        } catch {
          return this.failureResult(trace, evidence, toolViewerActionOutcomes, startedAt, "invalid_response_format");
        }
        trace.decisionRecorded(decisionForAnswer(
          modelResponse,
          problem.decisionContext.userRequest,
          problem.decisionContext.knownHardConstraints,
          problem.decisionContext.knownSoftPreferences,
          evidence.length > 0,
          iterations,
        ));
        const grounding = validateEvidenceAndClaims(evidence, generated.claims);
        if (
          !grounding.valid ||
          grounding.claims.some(({ groundingStatus }) =>
            groundingStatus === "unsupported")
        ) {
          const response = this.responseGenerator.groundingFailure();
          trace.responseGenerated(response, grounding.claims.map(({ id }) => id));
          trace.taskCompleted(
            "failed",
            elapsed(startedAt, this.now),
            "unsupported_claim",
          );
          return result(
            "failed",
            response,
            evidence,
            grounding.claims,
            toolViewerActionOutcomes,
            trace,
          );
        }
        const responseViewerActions = this.dependencies.viewerActionHandler?.apply(
          generated.viewerActions,
          evidence,
          request,
          trace,
        ) ?? [];
        trace.responseGenerated(generated.text, grounding.claims.map(({ id }) => id));
        trace.taskCompleted("completed", elapsed(startedAt, this.now));
        return result(
          "completed",
          generated.text,
          evidence,
          grounding.claims,
          [...toolViewerActionOutcomes, ...responseViewerActions],
          trace,
        );
      }
      if (toolCalls + calls.length > this.limits.maxToolCalls) {
        return this.limitResult(trace, evidence, toolViewerActionOutcomes, startedAt);
      }

      const toolResults: AgentModelContent[] = [];
      let terminalResponse: string | undefined;
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
        if (execution.result.ok && this.dependencies.viewerActionHandler) {
          const proposedActions = this.dependencies.toolViewerActions?.collect(
            call.name,
            execution.result.output,
          ) ?? [];
          toolViewerActionOutcomes.push(
            ...this.dependencies.viewerActionHandler.apply(
              proposedActions,
              evidence,
              request,
              trace,
            ),
          );
        }
        if (execution.result.ok) {
          terminalResponse ??= this.dependencies.terminalToolResult?.(
            call.name,
            execution.result.output,
          );
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
      if (terminalResponse !== undefined) {
        trace.responseGenerated(terminalResponse);
        trace.taskCompleted("completed", elapsed(startedAt, this.now));
        return result(
          "completed",
          terminalResponse,
          evidence,
          [],
          toolViewerActionOutcomes,
          trace,
        );
      }
      iterations += 1;
      trace.replanDecided(true, "Tool結果を受けて次の手順を判断する", plan.steps);
    }
  }

  private limitResult(
    trace: AgentTraceRecorder,
    evidence: Evidence[],
    viewerActions: AgentViewerActionOutcome[],
    startedAt: number,
  ): AgentRuntimeResult {
    const response = this.responseGenerator.limitReached();
    trace.responseGenerated(response);
    trace.taskCompleted("failed", elapsed(startedAt, this.now), "runtime_limit_reached");
    return result("limit_reached", response, evidence, [], viewerActions, trace);
  }

  private failureResult(
    trace: AgentTraceRecorder,
    evidence: Evidence[],
    viewerActions: AgentViewerActionOutcome[],
    startedAt: number,
    reason: string,
  ): AgentRuntimeResult {
    const response = this.responseGenerator.failure();
    trace.responseGenerated(response);
    trace.taskCompleted("failed", elapsed(startedAt, this.now), reason);
    return result("failed", response, evidence, [], viewerActions, trace);
  }
}

function result(
  status: AgentRuntimeResult["status"],
  response: string,
  evidence: Evidence[],
  claims: AssessedEvidenceClaim[],
  viewerActions: AgentViewerActionOutcome[],
  trace: AgentTraceRecorder,
): AgentRuntimeResult {
  return {
    status,
    response,
    evidence: [...evidence],
    claims: [...claims],
    viewerActions: [...viewerActions],
    trace: trace.snapshot(),
  };
}

function elapsed(startedAt: number, now: () => Date): number {
  return Math.max(0, now().getTime() - startedAt);
}

function decisionForToolCall(
  response: AgentModelResponse,
  toolName: string,
  fallbackGoal: string,
  fallbackHardConstraints: AgentDecisionTrace["hardConstraints"],
  fallbackSoftPreferences: AgentDecisionTrace["softPreferences"],
  iterations: number,
): AgentDecisionTrace {
  const expectedAction = toolName === "ask_follow_up" ? "ask_user" : "use_tool";
  const summary = response.decisionSummary;
  if (summary && summary.selectedAction === expectedAction &&
    summary.selectedTool === toolName) {
    return traceDecision(summary);
  }
  return {
    interpretedGoal: fallbackGoal,
    hardConstraints: fallbackHardConstraints,
    softPreferences: fallbackSoftPreferences,
    selectedAction: expectedAction,
    selectedTool: toolName,
    unresolvedFacts: [],
    reasonCodes: [response.decisionSummaryStatus === "invalid"
      ? "decision_summary_invalid"
      : iterations > 0 ? "result_driven_replan" : "initial_capability_selection"],
    ...(iterations > 0 ? { replanReason: "tool_result_received" } : {}),
  };
}

function decisionForAnswer(
  response: AgentModelResponse,
  fallbackGoal: string,
  fallbackHardConstraints: AgentDecisionTrace["hardConstraints"],
  fallbackSoftPreferences: AgentDecisionTrace["softPreferences"],
  hasEvidence: boolean,
  iterations: number,
): AgentDecisionTrace {
  const summary = response.decisionSummary;
  if (summary?.selectedAction === "answer" && summary.selectedTool === undefined) {
    return traceDecision(summary);
  }
  return {
    interpretedGoal: fallbackGoal,
    hardConstraints: fallbackHardConstraints,
    softPreferences: fallbackSoftPreferences,
    selectedAction: "answer",
    unresolvedFacts: [],
    reasonCodes: [response.decisionSummaryStatus === "invalid"
      ? "decision_summary_invalid"
      : hasEvidence ? "evidence_sufficient" : "no_factual_claim_required"],
    ...(iterations > 0 ? { replanReason: "tool_results_assessed" } : {}),
  };
}

function traceDecision(summary: AgentDecisionSummary): AgentDecisionTrace {
  return {
    interpretedGoal: summary.interpretedGoal,
    hardConstraints: summary.hardConstraints.map(({ key, value }) => ({
      key, value, source: "agent_interpretation",
    })),
    softPreferences: summary.softPreferences.map(({ key, value }) => ({
      key, value, source: "agent_interpretation",
    })),
    selectedAction: summary.selectedAction,
    ...(summary.selectedTool ? { selectedTool: summary.selectedTool } : {}),
    unresolvedFacts: summary.unresolvedFacts,
    reasonCodes: summary.reasonCodes,
    ...(summary.replanReason ? { replanReason: summary.replanReason } : {}),
  };
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
