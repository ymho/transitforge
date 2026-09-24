import { AgentTraceRecorder } from "./agent-trace";
import { invalidResponseContract, responseContractRepairInstruction } from "./response-contract";
import { groundedAnswerFailureCode, groundedAnswerInstruction, groundedAnswerRepairInstruction, hasStructuredPresentationEvidence } from "./grounded-answer";
import type {
  AgentModelContent,
  AgentModelClass,
  AgentModelMessage,
  AgentModelProvider,
  AgentModelResponse,
} from "./model-provider";
import { AgentModelError } from "./model-provider";
import {
  agentDecisionContextText,
  buildAgentDecisionContext,
} from "./agent-decision-context";
import {
  DefaultAgentResponseGenerator,
  hasOnlyInternalReasoning,
  type AgentResponseGenerator,
} from "./agent-response-generator";
import { AgentToolExecutor, type AgentToolExecution } from "./agent-tool-executor";
import {
  validateEvidenceAndClaims,
  mergeEvidenceObservations,
  type AssessedEvidenceClaim,
  type Evidence,
} from "./evidence-model";
import {
  validateAgentRuntimeLimits,
  type AgentRuntimeLimits,
} from "./runtime-policies";
import type { AgentRuntimeRequest, AgentRuntimeResult } from "./runtime-contract";
import type { AgentDecisionSummary } from "./agent-decision-summary";
import { validUsedEvidenceIds } from "./agent-decision-summary";
import { evidenceAwareTool } from "./evidence-tool-decision-support";
import { renderInTripAnswer, inTripToolPresentationReferences } from "./in-trip-answer-plan";
import type { AgentDecisionTrace } from "./agent-trace";
import { AgentToolRegistry } from "./tool-registry";
import { failedAgentToolResult } from "./tool-contract";
import { acceptsAgentTurn, askProgressRepairInstruction, observeAgentTurn, type AgentTurnObservation } from "./agent-turn-outcome";
import { agentTurnOutputContract, agentTurnPresentationOutputContract } from "./agent-output-contract";
import { compileAgentPrompt } from "./context-compiler";
import { withMeasuredResearchOutcome } from "./public-plan-presentation";
import type { ResearchExecutionLedger } from "./research-execution";
import type { ModelTokenRates } from "./model-usage-cost";
import type { AgentProgressReporter } from "./agent-progress";

export interface AgentRuntimeDependencies {
  model: AgentModelProvider;
  /** Evaluationや全呼出を同じclassへ固定する明示設定用。 */
  modelClass?: AgentModelClass;
  /** 自然文を分類せず、実行phaseと構造化Contextだけでmodel classを選ぶ。 */
  modelClassPolicy?: AgentModelClassPolicy;
  tools: AgentToolRegistry;
  toolExecutor: AgentToolExecutor;
  responseGenerator?: AgentResponseGenerator;
  terminalToolResult?: (toolName: string, output: unknown) => string | undefined;
  /** Application currentness/authority failure may end a stale execution without replanning. */
  terminalToolFailure?: () => string | undefined;
  /** Final presentation boundary, shared by terminal Tools and model answers. No tool routing. */
  prepareResponse?: (text: string, evidence: Evidence[], fromModel: boolean, asksUser?: boolean) => { text: string; observation: AgentTurnObservation };
  finalResponsePolicy?: (
    response: AgentModelResponse,
    request: AgentRuntimeRequest,
  ) => { accepted: boolean; reason?: string; instruction?: string };
  limits?: Partial<AgentRuntimeLimits>;
  now?: () => Date;
  /** Application-owned budget. Reservations happen before model/tool external calls. */
  researchLedger?: ResearchExecutionLedger;
  modelTokenRates?: (model: string | undefined) => ModelTokenRates | undefined;
  /** Coarse Application phase only. Never model reasoning, prompts or Tool payloads. */
  reportProgress?: AgentProgressReporter;
}

export interface AgentModelClassPolicyInput {
  request: AgentRuntimeRequest;
  phase: "initial" | "result_driven_replan";
}

export type AgentModelClassPolicy = (
  input: AgentModelClassPolicyInput,
) => AgentModelClass | undefined;

export class MultiStepAgentRuntime {
  private readonly responseGenerator: AgentResponseGenerator;
  private readonly limits: AgentRuntimeLimits;
  private readonly now: () => Date;

  constructor(private readonly dependencies: AgentRuntimeDependencies) {
    this.responseGenerator = dependencies.responseGenerator ??
      new DefaultAgentResponseGenerator();
    this.limits = validateAgentRuntimeLimits(dependencies.limits);
    this.now = dependencies.now ?? (() => new Date());
  }

  async run(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    await this.dependencies.reportProgress?.("understanding_request");
    const startedAt = this.now().getTime();
    const deadline = startedAt + this.limits.maxExecutionMs;
    const trace = new AgentTraceRecorder(request.executionId, { now: this.now,
      // History can quote previously opted-in notes even after consent removal.
      omitContent: request.omitTraceContent === true || request.context?.travelProfile?.consentedPreferenceNotes !== undefined || request.context?.conversation !== undefined });
    const evidence: Evidence[] = [];
    trace.taskStarted(request.userRequest);
    try {
      const initial = request.initialEvidence ?? [];
      if (!Array.isArray(initial) || initial.length > this.limits.maxEvidence ||
          !validateEvidenceAndClaims(initial, []).valid || initial.some((e) => !e.id.trim() ||
            e.references.some((r) => !r.sourceRef?.trim() || !r.summary?.trim()))) throw new Error("Invalid initial Evidence");
      evidence.push(...structuredClone(initial));
      if (evidence.length) trace.evidenceCollected(evidence);
    } catch {
      return this.failureResult(trace, evidence, startedAt, "invalid_initial_evidence");
    }

    const availableTools = this.dependencies.tools.descriptors();
    const decisionContext = buildAgentDecisionContext(request, availableTools);
    trace.intentNormalized(
      "bedrock_decision_required",
      Object.fromEntries(decisionContext.knownHardConstraints.map(
        ({ key, value }) => [key, value],
      )),
    );
    const decisionBoundary = agentDecisionBoundary(availableTools.length > 0);
    trace.planCreated(decisionBoundary);

    if (!decisionContext.userRequest.trim()) {
      const response = this.responseGenerator.followUp(["user_request"]);
      trace.responseGenerated(response);
      trace.taskCompleted("completed", elapsed(startedAt, this.now));
      return result("follow_up", response, evidence, [], trace);
    }

    const renderedDecisionContext = agentDecisionContextText(decisionContext);
    const messages: AgentModelMessage[] = [{
      role: "user",
      content: [{ type: "text", text: renderedDecisionContext },
        ...(decisionContext.inTrip?.trip.lifecycleState !== "in_trip" ? [{ type: "text" as const, text:
          "一般回答で外部事実を説明するときは提示されたEvidenceClaimへ結び付けます。根拠なしの具体的な経路・時刻は回答しないでください。外部事実を含まない挨拶・確認質問・会話にはClaimを要求しません。Tool結果・Proposal・in-trip回答は各既存contractに従います。" }] : []),
        ...(evidence.length && decisionContext.inTrip?.trip.lifecycleState !== "in_trip"
          ? [{ type: "text" as const, text: groundedAnswerInstruction(evidence, decisionContext.travelProfile) }] : [])],
    }];
    let modelCalls = 0;
    let toolCalls = 0;
    let iterations = 0;
    let hasToolResults = false;
    const nonRetryableFailureCounts = new Map<string, number>();
    const unavailableToolNames = new Set<string>();
    const executedToolCalls = new Map<string, AgentToolExecution & { toolName: string }>();
    let finalizeAfterToolResult = false;
    let correctedResponseContract = false;
    let correctedGroundedAnswer = false;
    let correctedFinalResponse = false;

    while (true) {
      if (
        iterations >= this.limits.maxIterations ||
        modelCalls >= this.limits.maxModelCalls ||
        this.now().getTime() >= deadline
      ) {
        return this.limitResult(trace, evidence, startedAt);
      }

      const remainingMs = Math.max(1, deadline - this.now().getTime());
      const selectedModelClass = this.dependencies.modelClassPolicy?.({
        request,
        phase: hasToolResults ? "result_driven_replan" : "initial",
      }) ?? this.dependencies.modelClass;
      const modelCallId = crypto.randomUUID();
      if (this.dependencies.researchLedger && !this.dependencies.researchLedger.reserve("modelCalls")) {
        return this.limitResult(trace, evidence, startedAt, this.dependencies.researchLedger.deadlineReached() ? "research_deadline" : "research_model_budget");
      }
      const finalResponseRequired = hasToolResults && (
        finalizeAfterToolResult ||
        iterations >= this.limits.maxIterations - 1 ||
        // Enter finalization with one model call still reserved for a bounded
        // contract/presentation repair. This avoids a valid research run ending
        // as a generic failure solely because its first final envelope is invalid.
        modelCalls >= this.limits.maxModelCalls - 2 ||
        toolCalls >= this.limits.maxToolCalls
      );
      await this.dependencies.reportProgress?.(finalResponseRequired ? "building_answer" : hasToolResults ? "comparing_options" : "understanding_request");
      // Bedrock requires toolConfig whenever the conversation history contains
      // toolUse/toolResult blocks. Keep the same capability contract attached
      // during finalization. The explicit instruction guides the model, while
      // the guard below deterministically rejects any further Tool execution.
      const modelTools = this.dependencies.tools.descriptors().filter(
        ({ name }) => !unavailableToolNames.has(name),
      ).map((tool) => evidenceAwareTool(tool, evidence));
      const modelMessages: AgentModelMessage[] = finalResponseRequired
        ? [...messages, {
          role: "user",
          content: [{
            type: "text",
            text: [
              "これがこの実行での最終回答フェーズです。Toolは追加実行できません。",
              "確認済みEvidence（Application Evidence + 今回のTool Evidence）を根拠に、現時点で分かることを利用者向けに簡潔にまとめてください。",
              "根拠が不足する場合は推測せず、不足している情報と利用者が次にできることを説明してください。",
              "既に会話Contextにある条件を聞き直さず、同じ質問や回答を繰り返さないでください。",
            ].join(" "),
          }],
        }]
        : messages;
      const outputContract = evidence.some(hasStructuredPresentationEvidence)
        ? agentTurnPresentationOutputContract
        : agentTurnOutputContract;
      const modelRequest = {
        messages: modelMessages,
        tools: modelTools,
        modelCallId,
        outputContract,
        prompt: compileAgentPrompt({ context: decisionContext, tools: modelTools,
          outputSchema: outputContract.schema, renderedContext: renderedDecisionContext }),
        ...(selectedModelClass === undefined
          ? {}
          : { modelClass: selectedModelClass }),
      } satisfies import("./model-provider").AgentModelRequest;
      trace.modelStarted(modelCallId, {
        ...(selectedModelClass === undefined ? {} : { modelClass: selectedModelClass }),
        messageCount: messages.length,
        toolNames: modelTools.map(({ name }) => name),
      });
      const modelOutcome = await modelBeforeDeadline(
        this.dependencies.model.generate(modelRequest),
        remainingMs,
      );
      if (modelOutcome.kind === "timeout") {
        trace.modelFailed(modelCallId, "runtime_timeout");
        return this.limitResult(trace, evidence, startedAt);
      }
      if (modelOutcome.kind === "error") {
        const code = modelOutcome.error instanceof AgentModelError ? modelOutcome.error.code : "provider_error";
        trace.modelFailed(modelCallId, code);
        return code === "timeout" || code === "truncation" ? this.limitResult(trace, evidence, startedAt, `model_${code}`) :
          this.failureResult(trace, evidence, startedAt, `model_${code}`);
      }
      let modelResponse = modelOutcome.value;
      modelCalls += 1;
      this.dependencies.researchLedger?.recordModel(modelResponse.metadata.usage, modelResponse.metadata.cacheStatus ?? "unknown",
        this.dependencies.modelTokenRates?.(modelResponse.metadata.model));
      const decodedPresentationKind = modelResponse.declaredPresentation?.kind;
      trace.modelCompleted(modelResponse.metadata, modelCallId,
        decodedPresentationKind === "source-explanation" || decodedPresentationKind === "travel-plan"
          ? decodedPresentationKind : undefined);
      const used = modelResponse.decisionSummary?.usedEvidenceIds ?? modelResponse.declaredEvidenceIds;
      const structuredPresentation = hasStructuredPresentation(modelResponse);
      // A structured presenter validates every source/photo reference itself. A malformed
      // decision-summary must not discard an otherwise valid, fully Evidence-bound payload.
      const invalidReferences = !structuredPresentation && (modelResponse.invalidUsedEvidenceIds || used !== undefined &&
        (!validUsedEvidenceIds(used) || used.some((id) => !evidence.some((e) => e.id === id))));
      const invalidContract = invalidReferences ? "invalid_used_evidence_ids" :
        structuredPresentation ? undefined : invalidResponseContract(modelResponse, (modelRequest.tools ?? []).map((tool) => tool.name));
      if (invalidContract) {
        if ((!finalResponseRequired && !correctedResponseContract) ||
            (finalResponseRequired && !correctedFinalResponse && modelCalls < this.limits.maxModelCalls)) {
          if (finalResponseRequired) correctedFinalResponse = true;
          else correctedResponseContract = true;
          messages.push({ role: "user", content: [{ type: "text", text: invalidReferences
            ? `${responseContractRepairInstruction}\n使用可能なEvidence ID: ${JSON.stringify(evidence.slice(0, 20).map((item) => item.id))}。候補ID・Trip item IDはEvidence IDではありません。0件なら事実を引用せず、必要なToolで根拠を取得してください。`
            : outputContract.schemaHash === agentTurnPresentationOutputContract.schemaHash
              ? `${responseContractRepairInstruction}\n現在のagent_turn_result@4-presentationではkind=answerのときtop-level presentationが必須です。responseTextへ旅程JSONを入れず、提示済みschemaに従うtravel-planまたはsource-explanation objectをpresentationへ設定してください。利用者判断だけが不足する場合はkind=askを使えます。`
              : responseContractRepairInstruction }] });
          // Finalization is already the last decision round. Spend one remaining
          // model call on contract repair without consuming another Tool round.
          if (!finalResponseRequired) iterations++;
          trace.replanDecided(true, invalidContract, decisionBoundary);
          continue;
        }
        return finalResponseRequired
          ? this.limitResult(trace, evidence, startedAt, invalidReferences ? "invalid_used_evidence_ids" : "invalid_response_contract")
          : this.failureResult(trace, evidence, startedAt,
            invalidReferences ? "invalid_used_evidence_ids" : "invalid_response_contract");
      }
      messages.push(modelResponse.message);

      if (modelResponse.stopReason === "max_tokens") {
        trace.modelFailed(modelCallId, "truncation");
        return this.limitResult(trace, evidence, startedAt, "model_truncation");
      }

      const calls = modelResponse.message.content.filter(
        (content): content is Extract<AgentModelContent, { type: "tool_call" }> =>
          content.type === "tool_call",
      );
      if (finalResponseRequired && calls.length > 0) {
        return this.limitResult(trace, evidence, startedAt);
      }
      if (calls.length > 0) {
        for (const call of calls) {
          trace.decisionRecorded(decisionForToolCall(
            modelResponse,
            call.name,
            decisionContext.userRequest,
            decisionContext.knownHardConstraints,
            decisionContext.knownSoftPreferences,
            iterations,
          ));
        }
      }
      if (modelResponse.stopReason === "tool_calls" && calls.length === 0) {
        return this.failureResult(trace, evidence, startedAt, "missing_tool_call");
      }
      if (modelResponse.stopReason !== "tool_calls") {
        await this.dependencies.reportProgress?.("validating_answer");
        let inTripRendered: ReturnType<typeof renderInTripAnswer> | undefined;
        // The in-trip factual channel accepts only structured references. Free prose cannot bypass
        // this boundary through a missing/invalid Decision Summary or a forged ask_user action.
        if (decisionContext.inTrip?.trip.lifecycleState === "in_trip") {
          const summary = modelResponse.decisionSummary;
          try {
            const plan = summary?.selectedAction === "answer" ? summary.inTripAnswerPlan : modelResponse.declaredInTripAnswerPlan;
            if (!plan) throw new Error("missing_plan");
            inTripRendered = renderInTripAnswer(plan, used ?? [], evidence);
            modelResponse = { ...modelResponse, message: { role: "assistant", content: [{ type: "text", text: inTripRendered.text }] } };
          } catch {
            // Result-driven wire-contract repair, not reflection or a Tool/intent router.
            // Never execute a tool encoded in prose or relax Evidence validation.
            if (!correctedResponseContract && !finalResponseRequired) {
              correctedResponseContract = true;
              // The rejected response may contain only stripped decision metadata, i.e. no
              // valid Converse content. Do not replay it (or its reasoning) as assistant text.
              messages.pop();
              messages.push({ role: "user", content: [{ type: "text", text:
                "応答の構造化contractが不正なため表示・実行していません。Toolが必要ならConverseのnative toolUseを使ってください。最終応答はkind=answerまたはkind=askです。回答の場合は実在Evidence IDと対応presentationからvalidなinTripAnswerPlanを返してください。変更案を説明textやAnswerPlan内のpatchで代用できません。利用者の依頼に必要な行動を再判断してください。" }] });
              iterations++;
              trace.replanDecided(true, "invalid_in_trip_response_contract", decisionBoundary);
              continue;
            }
            return this.failureResult(trace, evidence, startedAt, "invalid_in_trip_answer_plan");
          }
        }
        if (hasOnlyInternalReasoning(modelResponse)) {
          messages.pop();
          const canRepair = finalResponseRequired
            ? !correctedFinalResponse && modelCalls < this.limits.maxModelCalls
            : !correctedResponseContract;
          if (!canRepair) return finalResponseRequired
            ? this.limitResult(trace, evidence, startedAt, "invalid_response_contract")
            : this.failureResult(trace, evidence, startedAt, "invalid_response_contract");
          if (finalResponseRequired) correctedFinalResponse = true;
          else correctedResponseContract = true;
          messages.push({
            role: "user",
            content: [{
              type: "text",
              text: "内部推論は表示せず 必要なToolを実行するか 利用者向けの質問または回答だけを返してください",
            }],
          });
          if (!finalResponseRequired) iterations += 1;
          trace.replanDecided(
            true,
            "内部推論だけの応答を破棄して利用者向け応答を再要求する",
            decisionBoundary,
          );
          continue;
        }
        const taskPhase = request.context?.taskContext?.phase;
        const planningTurn = request.feature === "concierge" && (taskPhase === "discovery" || taskPhase === "draft" || taskPhase === "refine");
        const sourceEvidence = evidence.filter((item) => typeof item.facts.sourceExcerpt === "string" &&
          item.facts.status === "available" && item.facts.freshness === "fresh");
        const hasPlacePhoto = evidence.some((item) => typeof item.facts.imageUrl === "string" &&
          typeof item.facts.imageSourceUrl === "string" && typeof item.facts.imageAttribution === "string");
        const placePhotoAvailable = modelTools.some(({ name }) => name === "search_place_media");
        const priorVisibleProgress = request.context?.taskContext?.previousOutcome === "progress" ||
          request.context?.taskContext?.previousOutcome === "ask_and_progress";
        const planningGuard = planningTurn && shouldRequirePlanningProgress(modelResponse, priorVisibleProgress)
          ? { accepted: false, reason: "planning_progress_required", instruction:
            "この旅行相談は質問票だけで終えず、未確認条件を仮定として明記して具体案へ進めてください。プロフィール由来の情報を確定条件として列挙せず、必要な場所情報と写真はToolで調査してください。" }
          : planningTurn && sourceEvidence.length > 0 && !hasPlacePhoto && placePhotoAvailable
            ? { accepted: false, reason: "place_photo_required", instruction:
              "旅行先の資料は確認済みですが代表写真がありません。最終回答の前にsearch_place_mediaで各候補の写真を取得してください。" }
            : undefined;
        const finalResponseDecision = planningGuard ?? this.dependencies.finalResponsePolicy?.(
          modelResponse,
          request,
        );
        if (finalResponseDecision && !finalResponseDecision.accepted) {
          trace.decisionRecorded({
            interpretedGoal: decisionContext.userRequest,
            hardConstraints: decisionContext.knownHardConstraints,
            softPreferences: decisionContext.knownSoftPreferences,
            selectedAction: "answer",
            unresolvedFacts: [],
            reasonCodes: ["deterministic_policy_rejected_answer"],
            replanReason: finalResponseDecision.reason ?? "grounding_required",
          });
          if (finalResponseRequired) {
            return this.limitResult(
              trace,
              evidence,
              startedAt,
            );
          }
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
            decisionBoundary,
          );
          continue;
        }
        let generated;
        try {
          generated = inTripRendered ?? this.responseGenerator.fromModel(modelResponse, evidence,
            evidence.some((e) => Object.keys(e.facts).length > 0) ||
              (!evidence.length && [...executedToolCalls.values()].some((e) => this.dependencies.toolExecutor.collectsEvidence(e.toolName))) || (used?.length ?? 0) > 0 ||
              (modelResponse.decisionSummary?.selectedAction === "answer" && modelResponse.decisionSummary.reasonCodes.some((r) => r === "evidence_sufficient" || r === "evidence_required"))
              ? "grounded" : toolCalls ? "administrative" : "interaction", decisionContext.travelProfile, request.executionId);
        } catch (error) {
          const failureCode = groundedAnswerFailureCode(error);
          if ((!finalResponseRequired && !correctedGroundedAnswer) ||
              (finalResponseRequired && !correctedFinalResponse && modelCalls < this.limits.maxModelCalls)) {
            if (finalResponseRequired) correctedFinalResponse = true;
            else correctedGroundedAnswer = true;
            messages.pop();
            messages.push({ role: "user", content: [{ type: "text", text: `${responseContractRepairInstruction}\n${groundedAnswerRepairInstruction(error, evidence)}\n${groundedAnswerInstruction(evidence, decisionContext.travelProfile)}` }] });
            if (!finalResponseRequired) iterations++;
            trace.replanDecided(true, failureCode, decisionBoundary);
            continue;
          }
          return finalResponseRequired
            ? this.limitResult(trace, evidence, startedAt, failureCode)
            : this.failureResult(trace, evidence, startedAt, failureCode);
        }
        trace.decisionRecorded({ ...decisionForAnswer(
          modelResponse,
          decisionContext.userRequest,
          decisionContext.knownHardConstraints,
          decisionContext.knownSoftPreferences,
          evidence.length > 0,
          iterations,
        ), ...(inTripRendered ? { usedEvidenceIds: used ?? [], inTripAnswerPlan:
          modelResponse.decisionSummary?.inTripAnswerPlan ?? modelResponse.declaredInTripAnswerPlan } : {}) });
        const grounding = validateEvidenceAndClaims(evidence, generated.claims);
        if (
          !grounding.valid ||
          grounding.claims.some(({ groundingStatus }) =>
            groundingStatus === "unsupported")
        ) {
          if (finalResponseRequired) return this.limitResult(trace, evidence, startedAt, "unsupported_claim");
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
            trace,
          );
        }
        const asksUser = modelResponse.decisionSummary?.selectedAction === "ask_user";
        const prepared = this.dependencies.prepareResponse?.(generated.text, evidence, true, asksUser) ?? {
          text: generated.text,
          observation: observeAgentTurn(Boolean(asksUser), generated.publicPlanPresentation ? [{
            kind: "candidates",
            refs: [...generated.publicPlanPresentation.candidateOrder],
            ...(generated.publicPlanPresentation.photoRefs.length ? { mediaRefs: [...generated.publicPlanPresentation.photoRefs] } : {}),
          }] : []),
        };
        if (prepared) {
          const accepted = acceptsAgentTurn(request.context?.previousAssistantTurn, prepared.observation);
          trace.turnObserved(prepared.observation, accepted);
          if (!accepted) {
            messages.push({ role: "user", content: [{ type: "text", text: askProgressRepairInstruction }] });
            iterations += 1;
            trace.replanDecided(true, "consecutive_ask_only", decisionBoundary);
            continue;
          }
        }
        trace.responseGenerated(prepared?.text ?? generated.text, grounding.claims.map(({ id }) => id));
        trace.taskCompleted("completed", elapsed(startedAt, this.now));
        return result(
          "completed",
          prepared?.text ?? generated.text,
          evidence,
          grounding.claims,
          trace,
          prepared?.observation,
          generated.publicPlanPresentation ? withMeasuredResearchOutcome(generated.publicPlanPresentation,
            { modelCalls, toolCalls, wallClockMs: elapsed(startedAt, this.now), requestedMode: request.researchMode?.requestedMode ?? "standard",
              effectiveMode: request.researchMode?.effectiveMode ?? "standard" }) : undefined,
        );
      }
      if (toolCalls + calls.length > this.limits.maxToolCalls) {
        return this.limitResult(trace, evidence, startedAt);
      }
      if (calls.length && this.dependencies.researchLedger && !this.dependencies.researchLedger.reserve("toolCalls", calls.length)) {
        return this.limitResult(trace, evidence, startedAt, "research_tool_budget");
      }

      const toolResults: AgentModelContent[] = [];
      const toolPresentationEvidence: Evidence[] = [];
      let terminalResponse: string | undefined;
      const newlyUnavailableToolNames = new Set<string>();
      let duplicateToolCallDetected = false;
      if (calls.length) await this.dependencies.reportProgress?.("checking_information");
      for (const call of calls) {
        let applicationFailure: string | undefined;
        const signature = toolCallSignature(call.name, call.input);
        const previousExecution = executedToolCalls.get(signature);
        if (previousExecution) {
          const duplicateResult = previousExecution.result.ok
            ? failedAgentToolResult({
              code: "invalid_input",
              message: "同じToolと入力は既に実行済みです。直前の結果を使って回答してください。",
              retryable: false,
            })
            : previousExecution.result;
          trace.toolCalled(call.toolCallId, call.name, call.input);
          trace.toolCompleted(call.toolCallId, call.name, duplicateResult, 0);
          toolCalls += 1;
          if (duplicateResult.ok) continue;
          if (previousExecution.result.ok) {
            duplicateToolCallDetected = true;
          } else if (!duplicateResult.error.retryable) {
            const failureKey = nonRetryableFailureKey(
              call.name,
              duplicateResult.error.code,
              duplicateResult.error.message,
            );
            const failureCount = (nonRetryableFailureCounts.get(failureKey) ?? 0) + 1;
            nonRetryableFailureCounts.set(failureKey, failureCount);
            if (failureCount >= 2 && !unavailableToolNames.has(call.name)) {
              unavailableToolNames.add(call.name);
              newlyUnavailableToolNames.add(call.name);
            }
          }
          toolResults.push({
            type: "tool_result",
            toolCallId: call.toolCallId,
            status: "error",
            output: { error: duplicateResult.error },
          });
          continue;
        }
        const execution = await this.dependencies.toolExecutor.execute({
          executionId: request.executionId,
          toolCallId: call.toolCallId,
          toolName: call.name,
          toolInput: call.input,
          timeoutMs: Math.max(1, deadline - this.now().getTime()),
        }, trace);
        executedToolCalls.set(signature, { ...execution, toolName: call.name });
        toolCalls += 1;
        if (execution.result.ok) {
          // Context-dependent failures are not permanent. Let the model retry
          // them after a successful Tool has added information/changed task state.
          // Successful executions and permanent failures remain deduplicated.
          for (const [key, prior] of executedToolCalls) {
            if (prior.result.ok || prior.result.error.code !== "precondition_failed") continue;
            executedToolCalls.delete(key);
            const toolName = prior.toolName;
            nonRetryableFailureCounts.delete(nonRetryableFailureKey(
              toolName, prior.result.error.code, prior.result.error.message,
            ));
            const stillBlocked = [...executedToolCalls.values()].some((cached) =>
              cached.toolName === toolName && !cached.result.ok &&
              (nonRetryableFailureCounts.get(nonRetryableFailureKey(
                toolName, cached.result.error.code, cached.result.error.message,
              )) ?? 0) >= 2);
            if (!stillBlocked) {
              unavailableToolNames.delete(toolName);
              newlyUnavailableToolNames.delete(toolName);
            }
          }
        }
        if (execution.evidence.length > 0) {
          const merged = mergeEvidenceObservations(evidence, execution.evidence, this.limits.maxEvidence);
          evidence.splice(0, evidence.length, ...merged.evidence);
          toolPresentationEvidence.push(...merged.added);
          if (merged.added.length > 0) trace.evidenceCollected(merged.added);
          if (merged.collisions.length > 0) {
            applicationFailure = this.dependencies.terminalToolFailure?.();
          }
        }
        if (execution.result.ok) {
          terminalResponse ??= this.dependencies.terminalToolResult?.(
            call.name,
            execution.result.output,
          );
        } else if (!execution.result.error.retryable) {
          applicationFailure = this.dependencies.terminalToolFailure?.();
          // A conflict invalidates earlier successes from this execution as well.
          if (applicationFailure !== undefined) terminalResponse = applicationFailure;
          const failureKey = nonRetryableFailureKey(
            call.name,
            execution.result.error.code,
            execution.result.error.message,
          );
          const failureCount = (nonRetryableFailureCounts.get(failureKey) ?? 0) + 1;
          nonRetryableFailureCounts.set(failureKey, failureCount);
          if (failureCount >= 2 && !unavailableToolNames.has(call.name)) {
            unavailableToolNames.add(call.name);
            newlyUnavailableToolNames.add(call.name);
          }
        }
        toolResults.push({
          type: "tool_result",
          toolCallId: call.toolCallId,
          status: execution.result.ok ? "success" : "error",
          output: execution.result.ok
            ? execution.result.output
            : { error: execution.result.error },
        });
        if (applicationFailure !== undefined) break;
      }
      messages.push({
        role: "user",
        content: [
          ...toolResults,
          ...(decisionContext.inTrip?.trip.lifecycleState !== "in_trip" && (evidence.some((e) => Object.keys(e.facts).length > 0) ||
              [...executedToolCalls.values()].some((e) => this.dependencies.toolExecutor.collectsEvidence(e.toolName)))
            ? [{ type: "text" as const, text: groundedAnswerInstruction(evidence, decisionContext.travelProfile) }] : []),
          ...(decisionContext.inTrip?.trip.lifecycleState === "in_trip" && toolPresentationEvidence.length ? [{
            type: "text" as const,
            text: `今回Toolから収集したEvidenceと対応するAnswerPlan presentation（取得不能も確認された取得結果であり、外部事実の確認とは別）: ${inTripToolPresentationReferences(toolPresentationEvidence)}`,
          }] : []),
          ...(newlyUnavailableToolNames.size === 0 ? [] : [{
            type: "text" as const,
            text: "同じ再試行不可エラーを繰り返したToolはこの実行では利用できません。別のToolまたは利用者向け回答を選択してください",
          }]),
        ],
      });
      hasToolResults = true;
      finalizeAfterToolResult ||= duplicateToolCallDetected;
      if (terminalResponse !== undefined) {
        const prepared = this.dependencies.prepareResponse?.(terminalResponse, evidence, false) ?? {
          text: terminalResponse,
          observation: observeAgentTurn(false, []),
        };
        if (prepared) {
          const accepted = acceptsAgentTurn(request.context?.previousAssistantTurn, prepared.observation);
          trace.turnObserved(prepared.observation, accepted);
          if (!accepted) {
            messages.push({ role: "user", content: [{ type: "text", text: askProgressRepairInstruction }] });
            iterations += 1;
            trace.replanDecided(true, "consecutive_ask_only", decisionBoundary);
            continue;
          }
          terminalResponse = prepared.text;
        }
        trace.responseGenerated(terminalResponse);
        trace.taskCompleted("completed", elapsed(startedAt, this.now));
        return result(
          "completed",
          terminalResponse,
          evidence,
          [],
          trace,
          prepared?.observation,
        );
      }
      iterations += 1;
      trace.replanDecided(
        true,
        duplicateToolCallDetected
          ? "同一入力のTool再実行を止めて確認済み結果から最終回答する"
          : newlyUnavailableToolNames.size > 0
          ? "同じ再試行不可エラーを繰り返したToolを除外して再計画する"
          : "Tool結果を受けて次の手順を判断する",
        decisionBoundary,
      );
    }
  }

  private limitResult(
    trace: AgentTraceRecorder,
    evidence: Evidence[],
    startedAt: number,
    reason = "runtime_limit_reached",
  ): AgentRuntimeResult {
    const response = this.responseGenerator.limitReached(evidence.length > 0);
    trace.responseGenerated(response);
    trace.taskCompleted("failed", elapsed(startedAt, this.now), reason);
    return result("limit_reached", response, evidence, [], trace);
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
    return result("failed", response, evidence, [], trace);
  }
}

function hasStructuredPresentation(response: AgentModelResponse): boolean {
  if (response.declaredPresentation?.kind === "source-explanation" || response.declaredPresentation?.kind === "travel-plan") return true;
  const text = response.message.content.filter((item): item is Extract<AgentModelContent, { type: "text" }> => item.type === "text")
    .map(({ text }) => text).join("\n");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) return false;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === "object" && value !== null && "kind" in value &&
      (value.kind === "source-explanation" || value.kind === "travel-plan");
  } catch { return false; }
}

function toolCallSignature(
  toolName: string,
  input: Record<string, unknown>,
): string {
  return `${toolName}:${canonicalJson(input)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function agentDecisionBoundary(hasTools: boolean): string[] {
  return [
    "構造化Contextから目的 制約 嗜好 未解決事項をBedrockが判断する",
    hasTools
      ? "Bedrockが能力contractから次のTool 質問 回答を選択する"
      : "Bedrockが既知Contextだけで質問または回答を選択する",
    "決定論的なEvidence Policyと安全制約で結果を検証する",
  ];
}

function result(
  status: AgentRuntimeResult["status"],
  response: string,
  evidence: Evidence[],
  claims: AssessedEvidenceClaim[],
  trace: AgentTraceRecorder,
  turnObservation?: AgentTurnObservation,
  publicPlanPresentation?: import("./public-plan-presentation").PublicPlanPresentation,
): AgentRuntimeResult {
  return {
    ...(status === "completed" && turnObservation ? { turnObservation } : {}),
    ...(status === "completed" && publicPlanPresentation ? { publicPlanPresentation } : {}),
    status,
    response,
    evidence: [...evidence],
    claims: [...claims],
    trace: trace.snapshot(),
  };
}

function hasPlanningQuestionnaire(response: AgentModelResponse): boolean {
  const text = response.message.content
    .flatMap((content) => content.type === "text" ? [content.text] : [])
    .join("\n");
  const asksForOptionalDetails = /(?:出発地|出発駅|どこから|予算|人数|何名|同行者|泊数|何泊|滞在期間|目的地|行き先|旅行日程|宿泊日数|地域|アクティビティ|自然スポット|好み)[\s\S]{0,100}(?:[?？]|ですか|ますか|教えてください|お知らせください)/u.test(text);
  return asksForOptionalDetails;
}

function shouldRequirePlanningProgress(response: AgentModelResponse, priorVisibleProgress: boolean): boolean {
  const summary = response.decisionSummary;
  if (summary?.selectedAction === "ask_user") {
    const requirements = summary.missingRequirements ?? [];
    const authorizationRequired = requirements.some((item) => item.action === "ask" && item.resolution === "authorization");
    const safetyRequired = summary.reasonCodes.includes("safety_boundary");
    const selectionAfterProgress = priorVisibleProgress && requirements.some((item) =>
      item.action === "ask" && item.resolution === "user_decision");
    // `user_confirmation_required` alone is not a license to turn an open-ended
    // discovery into a questionnaire. First show candidates; selection may be
    // requested on a later turn after visible progress has been persisted.
    return !(authorizationRequired || safetyRequired || selectionAfterProgress);
  }
  // Temporary measured safety net until PR2 makes typed provider output the sole path.
  // A legacy model labelling a questionnaire as `answer` must not bypass the typed ask contract.
  return hasPlanningQuestionnaire(response);
}

function elapsed(startedAt: number, now: () => Date): number {
  return Math.max(0, now().getTime() - startedAt);
}

function nonRetryableFailureKey(
  toolName: string,
  code: string,
  message: string,
): string {
  return JSON.stringify([toolName, code, message]);
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
  if (summary?.selectedAction === "ask_user" || summary?.selectedAction === "answer" && summary.selectedTool === undefined) {
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
    ...(summary.usedEvidenceIds ? { usedEvidenceIds: [...summary.usedEvidenceIds] } : {}),
    ...(summary.inTripAnswerPlan ? { inTripAnswerPlan: summary.inTripAnswerPlan } : {}),
  };
}

type ModelDeadlineResult<T> =
  | { kind: "success"; value: T }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown };

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
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ kind: "error", error });
    });
  });
}
