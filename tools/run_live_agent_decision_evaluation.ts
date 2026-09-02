import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AwsBedrockConverseClient } from "../backend/agent-api/src/adapters/aws-sdk-clients";
import { BedrockConversationModel } from "../backend/agent-api/src/adapters/bedrock-conversation-model";
import { agentSystemPrompt } from "../backend/agent-api/src/usecases/agent-system-prompt";
import {
  ConverseModelProvider,
  validateViewerAgentToolPreconditions,
  viewerAgentToolDescriptors,
  type BedrockAgentConverse,
  type ViewerAgentToolName,
} from "../frontend/src/adapters/bedrock/viewer-agent-runtime";
import { AgentToolExecutor } from "../frontend/src/usecases/agent/agent-tool-executor";
import { validateAgentToolInput } from "../frontend/src/usecases/agent/agent-tool-input-validator";
import { MultiStepAgentRuntime } from "../frontend/src/usecases/agent/agent-runtime";
import type { AgentRuntimeContextInput } from "../frontend/src/usecases/agent/agent-decision-context";
import { observeAgentRuntimeResult, evaluateAgentDataset } from "../frontend/src/usecases/agent/evaluation/agent-evaluator";
import type {
  AgentEvaluationCase,
  AgentEvaluationDataset,
  AgentEvaluationObservation,
} from "../frontend/src/usecases/agent/evaluation/evaluation-contract";
import { renderAgentEvaluationMarkdown } from "../frontend/src/usecases/agent/evaluation/evaluation-report";
import {
  renderAgentEvaluationStabilityMarkdown,
  summarizeAgentEvaluationStability,
} from "../frontend/src/usecases/agent/evaluation/evaluation-stability";
import type { AgentModelClass } from "../frontend/src/usecases/agent/model-provider";
import { structuredModelClassPolicy } from "../frontend/src/usecases/agent/structured-model-class-policy";
import {
  failedAgentToolResult,
  successfulAgentToolResult,
  type AgentTool,
} from "../frontend/src/usecases/agent/tool-contract";
import { ToolEvidenceRegistry } from "../frontend/src/usecases/agent/tool-evidence-registry";
import { AgentToolRegistry } from "../frontend/src/usecases/agent/tool-registry";

interface LiveDecisionCase {
  evaluation: AgentEvaluationCase;
  context: AgentRuntimeContextInput;
  availableTools: ViewerAgentToolName[];
  toolOutcomes?: Partial<Record<ViewerAgentToolName, Record<string, unknown>>>;
  expectedToolInputs?: Partial<Record<ViewerAgentToolName, Record<string, unknown>>>;
  terminalTools?: ViewerAgentToolName[];
}

const modelClass = parseModelClass(argument("--model-class") ?? "default");
const modelRouting = argument("--model-routing") ?? "single";
if (modelRouting !== "single" && modelRouting !== "structured-decision") {
  throw new Error("--model-routingはsingleまたはstructured-decisionで指定してください");
}
const profile = argument("--profile") ?? "smoke";
if (profile !== "smoke" && profile !== "full") {
  throw new Error("--profileはsmokeまたはfullで指定してください");
}
const strategy = argument("--strategy") ?? `single-${modelClass}`;
const repetitions = positiveIntegerArgument("--repetitions", 1, 10);
const outputDirectory = resolve(
  argument("--output-dir") ?? `/tmp/raiquora-live-agent-eval/${strategy}`,
);
const selectedCase = argument("--case");
const cases = liveDecisionCases().filter(({ evaluation }) =>
  (profile === "full" || evaluation.tags.includes("smoke")) &&
  (selectedCase === undefined || evaluation.id === selectedCase));
if (cases.length === 0) throw new Error("対象となるLive Eval caseがありません");
const model = new BedrockConversationModel(new AwsBedrockConverseClient(), {
  modelId: process.env.MODEL_ID?.trim() || "amazon.nova-lite-v1:0",
  ...(process.env.LIGHTWEIGHT_MODEL_ID?.trim()
    ? { lightweightModelId: process.env.LIGHTWEIGHT_MODEL_ID.trim() }
    : {}),
  ...(process.env.DECISION_MODEL_ID?.trim()
    ? { decisionModelId: process.env.DECISION_MODEL_ID.trim() }
    : {}),
  systemPrompt: agentSystemPrompt,
});
const modelFailures: string[] = [];
const converse: BedrockAgentConverse = async (messages, tools, requestedClass) => {
  try {
    const response = await model.converse({
      messages,
      ...(tools ? { tools } : {}),
      ...(requestedClass ? { modelClass: requestedClass } : {}),
    });
    return {
      message: response.message,
      stopReason: response.stopReason,
      metadata: response.metadata,
    };
  } catch (error) {
    modelFailures.push(safeFailure(error));
    throw error;
  }
};

const observationsByAttempt: AgentEvaluationObservation[][] = [];
const traces = [];
for (let attempt = 1; attempt <= repetitions; attempt += 1) {
  const observations: AgentEvaluationObservation[] = [];
  for (const item of cases) {
    const registry = evaluationToolRegistry(
      item.availableTools,
      item.toolOutcomes,
      item.expectedToolInputs,
      item.context,
    );
    const runtime = new MultiStepAgentRuntime({
      model: new ConverseModelProvider(converse),
      ...(modelRouting === "structured-decision"
        ? { modelClassPolicy: structuredModelClassPolicy }
        : { modelClass }),
      tools: registry,
      toolExecutor: new AgentToolExecutor(registry, new ToolEvidenceRegistry()),
      // 既定は初期能力選択だけを測る。Multi-step caseだけは事実を含まない
      // version付きfixture結果を返し、指定した最終Toolまで結果駆動replanを測る。
      terminalToolResult: (toolName) => (item.terminalTools ?? item.availableTools)
        .includes(toolName as ViewerAgentToolName)
        ? `Live Evalで${toolName}の選択を確認しました`
        : undefined,
      limits: { maxIterations: 2, maxModelCalls: 2, maxToolCalls: 2, maxExecutionMs: 60_000 },
    });
    const result = await runtime.run({
      executionId: `live-eval-${item.evaluation.id}-attempt-${attempt}-${crypto.randomUUID()}`,
      feature: item.evaluation.feature,
      userRequest: item.evaluation.userRequest,
      context: item.context,
    });
    observations.push(observeAgentRuntimeResult(item.evaluation.id, result));
    traces.push(result.trace);
  }
  observationsByAttempt.push(observations);
}

const dataset: AgentEvaluationDataset = {
  schemaVersion: "agent-eval-dataset-v1",
  cases: cases.map(({ evaluation }) => evaluation),
};
const reports = observationsByAttempt.map((observations) => evaluateAgentDataset(dataset, {
  schemaVersion: "agent-eval-observations-v1",
  observations,
}));
const stability = summarizeAgentEvaluationStability(reports);
// 従来reportは互換性を保ちつつ、1回でも失敗したcaseを代表観測にして
// passedCaseCountを「全反復で安定したcase数」と一致させる。
const stableObservations = cases.map(({ evaluation }, caseIndex) => {
  const failedAttempt = reports.findIndex((report) => !report.cases[caseIndex]?.passed);
  return observationsByAttempt[failedAttempt < 0 ? 0 : failedAttempt]![caseIndex]!;
});
const report = evaluateAgentDataset(dataset, {
  schemaVersion: "agent-eval-observations-v1",
  observations: stableObservations,
});
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(`${outputDirectory}/agent-eval-report.json`, `${JSON.stringify(report, null, 2)}\n`),
  writeFile(`${outputDirectory}/agent-eval-report.md`, renderAgentEvaluationMarkdown(report)),
  writeFile(`${outputDirectory}/agent-eval-stability.json`, `${JSON.stringify(stability, null, 2)}\n`),
  writeFile(`${outputDirectory}/agent-eval-stability.md`, renderAgentEvaluationStabilityMarkdown(stability)),
  writeFile(`${outputDirectory}/agent-eval-traces.json`, `${JSON.stringify(traces, null, 2)}\n`),
]);
console.log(
  `Live Agent Decision Eval (${strategy}, ${repetitions}x): ` +
  `${stability.stableCaseCount}/${stability.caseCount} stable ` +
  `(${outputDirectory})`,
);
if (modelFailures.length > 0) {
  console.error(`Bedrock failures: ${[...new Set(modelFailures)].join(" / ")}`);
}
if (stability.stableCaseCount !== stability.caseCount) process.exitCode = 1;

function evaluationToolRegistry(
  names: ViewerAgentToolName[],
  outcomes: LiveDecisionCase["toolOutcomes"],
  expectedInputs: LiveDecisionCase["expectedToolInputs"],
  context: AgentRuntimeContextInput,
): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  for (const descriptor of viewerAgentToolDescriptors(names, {
    tripContext: context.tripContext,
  })) {
    const tool: AgentTool<Record<string, unknown>, Record<string, unknown>> = {
      ...descriptor,
      parseInput(value) {
        const parsed = validateAgentToolInput(descriptor.inputSchema, value);
        if (!parsed.ok) return parsed;
        const preconditionFailure = validateViewerAgentToolPreconditions(
          descriptor.name as ViewerAgentToolName,
          parsed.input,
          { tripContext: context.tripContext },
        );
        return preconditionFailure
          ? { ok: false, error: { code: "invalid_input", message: preconditionFailure, retryable: false } }
          : parsed;
      },
      async execute(input) {
        const expected = expectedInputs?.[descriptor.name];
        if (expected && !Object.entries(expected).every(([key, value]) =>
          JSON.stringify(input[key]) === JSON.stringify(value))) {
          return failedAgentToolResult({
            code: "invalid_input",
            message: "Live Evalで期待する構造化入力と一致しません",
            retryable: false,
          });
        }
        return successfulAgentToolResult(outcomes?.[descriptor.name] ?? {
          evaluatedTool: descriptor.name,
          acceptedInputKeys: Object.keys(input).sort(),
        });
      },
    };
    registry.register(tool);
  }
  return registry;
}

function liveDecisionCases(): LiveDecisionCase[] {
  const featureContext = {
    calendarDate: "2026-08-30",
    serviceDate: "2026-08-30",
    displayTimeMinutes: 12 * 60,
  };
  const profile = {
    home: { station: "向日町", carAvailable: false },
    pace: 0.4,
    favoriteInterests: ["history", "nature"],
    avoidances: ["crowds"],
  };
  const currentJourney = {
    contextKind: "previous_verified_journey",
    originStation: "京都",
    destinationStation: "出雲市",
    departureDate: "2026-08-31",
    journeys: [{
      departureTimeMinutes: 480,
      arrivalTimeMinutes: 720,
      transferCount: 1,
      legs: [{
        serviceUid: "fixture:nozomi-99", trainNumber: "99A", serviceType: "新幹線",
        trainName: "のぞみ99号", originStation: "京都", destinationStation: "岡山",
        departureTimeMinutes: 480, arrivalTimeMinutes: 540,
        stops: [
          { stationName: "京都", departureTimeMinutes: 480 },
          { stationName: "新大阪", departureTimeMinutes: 495 },
          { stationName: "新神戸", departureTimeMinutes: 510 },
          { stationName: "岡山", arrivalTimeMinutes: 540 },
        ],
      }, {
        serviceUid: "fixture:yakumo-5", trainNumber: "1005M", serviceType: "特急",
        trainName: "やくも5号", originStation: "岡山", destinationStation: "出雲市",
        departureTimeMinutes: 553, arrivalTimeMinutes: 720,
      }],
    }],
  };
  return [
    liveCase({
      id: "destination-inspiration-first",
      name: "目的地だけなら日程質問より先に場所のEvidenceを調べる",
      userRequest: "出雲大社に行きたい",
      tags: ["smoke", "ambiguous-request"],
      expectedTool: "search_place_media",
      constraints: { destination: "出雲大社" },
      requiredHardConstraintKeys: ["destination"],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: { planningStage: "inspiration", destinationWish: "出雲大社" },
        knownHardConstraints: [{ key: "destination", value: "出雲大社", source: "trip_context" }],
      },
      availableTools: ["search_place_media", "ask_follow_up", "search_accommodations", "plan_day_trip"],
    }),
    liveCase({
      id: "planning-missing-date",
      name: "旅程化を希望した後に不足する出発日だけを尋ねる",
      userRequest: "旅程を考えたい",
      tags: ["smoke", "information-gap"],
      expectedTool: "ask_follow_up",
      constraints: { destination: "出雲大社" },
      requiredHardConstraintKeys: ["destination"],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: { planningStage: "planning", destinationWish: "出雲大社" },
        knownHardConstraints: [{ key: "destination", value: "出雲大社", source: "trip_context" }],
      },
      availableTools: ["ask_follow_up", "search_place_media", "search_accommodations", "plan_day_trip"],
      expectedToolInputs: {
        ask_follow_up: { expectedInput: "departure-date" },
      },
    }),
    liveCase({
      id: "known-date-missing-stay",
      name: "既知の出発日を聞き直さず泊数だけを尋ねる",
      userRequest: "明日",
      tags: ["smoke", "information-gap", "constraint"],
      expectedTool: "ask_follow_up",
      constraints: { destination: "出雲大社", start_date: "2026-08-31" },
      requiredHardConstraintKeys: ["destination", "start_date"],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: {
          planningStage: "planning", destinationWish: "出雲大社", startDate: "2026-08-31",
        },
        knownHardConstraints: [
          { key: "destination", value: "出雲大社", source: "trip_context" },
          { key: "start_date", value: "2026-08-31", source: "trip_context" },
        ],
      },
      availableTools: ["ask_follow_up", "search_accommodations", "plan_day_trip"],
      expectedToolInputs: {
        ask_follow_up: { expectedInput: "stay-length" },
      },
    }),
    liveCase({
      id: "known-overnight-schedule",
      name: "日程と泊数が揃えば宿泊Evidenceを検索する",
      userRequest: "2泊",
      tags: ["constraint"],
      expectedTool: "search_accommodations",
      constraints: {
        destination: "出雲大社", start_date: "2026-08-31", end_date: "2026-09-02", stay_nights: 2,
      },
      requiredHardConstraintKeys: ["destination", "start_date", "end_date", "stay_nights"],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: {
          planningStage: "planning", destinationWish: "出雲大社", startDate: "2026-08-31",
          endDate: "2026-09-02", stayNights: 2,
        },
        knownHardConstraints: [
          { key: "destination", value: "出雲大社", source: "trip_context" },
          { key: "start_date", value: "2026-08-31", source: "trip_context" },
          { key: "end_date", value: "2026-09-02", source: "trip_context" },
          { key: "stay_nights", value: 2, source: "trip_context" },
        ],
      },
      availableTools: ["ask_follow_up", "search_accommodations", "plan_day_trip", "search_direct_routes"],
    }),
    liveCase({
      id: "known-future-day-trip",
      name: "未来日の日帰りは片道検索でなく日帰り能力を選ぶ",
      userRequest: "日帰り",
      tags: ["constraint"],
      expectedTool: "plan_day_trip",
      constraints: { destination: "出雲大社", start_date: "2026-08-31", stay_nights: 0 },
      requiredHardConstraintKeys: ["destination", "start_date", "stay_nights"],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: {
          planningStage: "planning", destinationWish: "出雲大社", startDate: "2026-08-31",
          endDate: "2026-08-31", stayNights: 0,
        },
        knownHardConstraints: [
          { key: "destination", value: "出雲大社", source: "trip_context" },
          { key: "start_date", value: "2026-08-31", source: "trip_context" },
          { key: "stay_nights", value: 0, source: "trip_context" },
        ],
      },
      availableTools: ["ask_follow_up", "plan_day_trip", "search_direct_routes", "search_accommodations"],
    }),
    liveCase({
      id: "return-arrival-update",
      name: "現在旅程の帰着期限変更は復路更新能力を選ぶ",
      userRequest: "夜21時には家に着いていたい",
      tags: ["constraint"],
      expectedTool: "search_trip_route_update",
      constraints: { return_arrival_deadline_minutes: 21 * 60 },
      requiredHardConstraintKeys: ["return_arrival_deadline_minutes"],
      context: {
        featureContext,
        currentTrip: {
          destination: "出雲大社",
          schedule: [{ type: "movement", mode: "rail", origin: "出雲市", destination: "向日町" }],
        },
        tripContext: { destinationWish: "出雲大社", returnArrivalTimeMinutes: 21 * 60 },
        knownHardConstraints: [{
          key: "return_arrival_deadline_minutes", value: 21 * 60, source: "trip_context",
        }],
      },
      availableTools: ["ask_follow_up", "search_trip_route_update", "propose_trip_update"],
    }),
    liveCase({
      id: "mood-first-discovery",
      name: "気分だけの相談では目的地を決め打ちせず候補を検索する",
      userRequest: "リラックスできる場所に行きたい",
      tags: ["ambiguous-request"],
      expectedTool: "search_web",
      constraints: {},
      requiredHardConstraintKeys: [],
      // Viewerは会話開始直後に空のTripContextを渡すことがある。
      // 空objectでも目的地未定の探索として扱えることを本番モデルで測る。
      context: { featureContext, travelProfile: profile, tripContext: {} },
      availableTools: ["search_web", "search_place_media", "ask_follow_up"],
    }),
    liveCase({
      id: "previous-journey-stops",
      name: "直前経路の途中駅は経路照会能力を選ぶ",
      userRequest: "京都から岡山までに停車する駅は？",
      tags: ["smoke", "constraint"],
      expectedTool: "inspect_previous_journey",
      constraints: {},
      requiredHardConstraintKeys: [],
      context: { featureContext, currentJourney },
      availableTools: ["inspect_previous_journey", "search_direct_routes", "ask_follow_up"],
      expectedToolInputs: {
        inspect_previous_journey: {
          action: "inspect_stops", journeyIndex: 0, legIndex: 0,
        },
      },
    }),
    liveCase({
      id: "previous-journey-constraint",
      name: "直前経路の新幹線回避は同一区間の再検索能力を選ぶ",
      userRequest: "新幹線を使いたくない",
      tags: ["smoke", "constraint"],
      expectedTool: "revise_previous_journey",
      constraints: {},
      requiredHardConstraintKeys: [],
      context: { featureContext, currentJourney },
      availableTools: ["revise_previous_journey", "search_direct_routes", "ask_follow_up"],
      expectedToolInputs: {
        revise_previous_journey: {
          action: "revise_constraints", excludedServiceTypes: ["新幹線"],
        },
      },
    }),
    liveCase({
      id: "pending-alternative-confirmation",
      name: "提示済みの代替列車は聞き直さず選択を反映する",
      userRequest: "1番に変更して",
      tags: ["constraint"],
      expectedTool: "revise_previous_journey",
      constraints: {},
      requiredHardConstraintKeys: [],
      context: {
        featureContext,
        currentJourney: {
          ...currentJourney,
          pendingAlternatives: [{
            alternativeIndex: 0, trainNumber: "101A", serviceType: "新幹線",
            trainName: "のぞみ101号", originStation: "京都", destinationStation: "岡山",
            departureTimeMinutes: 510, arrivalTimeMinutes: 570,
          }],
        },
      },
      availableTools: ["revise_previous_journey", "ask_follow_up"],
      expectedToolInputs: {
        revise_previous_journey: {
          action: "apply_alternative", alternativeIndex: 0,
        },
      },
    }),
    liveCase({
      id: "place-search-result-driven-replan",
      name: "地点検索が空なら固定ReflectionなしでWeb発見へ再計画する",
      userRequest: "西条の賀茂鶴酒造の写真と場所を見たい",
      tags: ["smoke", "multi-tool", "information-gap"],
      expectedTools: ["search_place_media", "search_web"],
      constraints: {},
      requiredHardConstraintKeys: [],
      context: { featureContext, travelProfile: profile },
      availableTools: ["search_place_media", "search_web", "ask_follow_up"],
      toolOutcomes: {
        search_place_media: {
          schemaVersion: "live-eval-tool-outcome-v1",
          matchCount: 0,
          limitation: "検証可能な一致地点がありません",
        },
      },
      terminalTools: ["search_web"],
    }),
  ];
}

function liveCase(input: {
  id: string;
  name: string;
  userRequest: string;
  tags: string[];
  expectedTool?: ViewerAgentToolName;
  expectedTools?: ViewerAgentToolName[];
  constraints: Record<string, string | number | boolean | string[]>;
  requiredHardConstraintKeys: string[];
  context: AgentRuntimeContextInput;
  availableTools: ViewerAgentToolName[];
  toolOutcomes?: LiveDecisionCase["toolOutcomes"];
  expectedToolInputs?: LiveDecisionCase["expectedToolInputs"];
  terminalTools?: ViewerAgentToolName[];
}): LiveDecisionCase {
  return {
    evaluation: {
      id: input.id,
      name: input.name,
      feature: "concierge",
      userRequest: input.userRequest,
      tags: input.tags,
      expected: {
        toolSequence: input.expectedTools ?? (input.expectedTool ? [input.expectedTool] : []),
        constraints: input.constraints,
        status: "completed",
        minimumGroundedClaimRate: 0,
        maximumUnsupportedClaimRate: 0,
        allowedViewerActions: [],
        requiredViewerActions: [],
        decision: {
          requiredHardConstraintKeys: input.requiredHardConstraintKeys,
          forbiddenUnresolvedFacts: input.requiredHardConstraintKeys,
        },
      },
    },
    context: input.context,
    availableTools: input.availableTools,
    ...(input.toolOutcomes ? { toolOutcomes: input.toolOutcomes } : {}),
    ...(input.expectedToolInputs ? { expectedToolInputs: input.expectedToolInputs } : {}),
    ...(input.terminalTools ? { terminalTools: input.terminalTools } : {}),
  };
}

function parseModelClass(value: string): AgentModelClass {
  if (value === "default" || value === "lightweight" || value === "decision") return value;
  throw new Error("--model-classはdefault lightweight decisionのいずれかです");
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function positiveIntegerArgument(name: string, fallback: number, maximum: number): number {
  const raw = argument(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name}は1から${maximum}の整数で指定してください`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeFailure(error: unknown): string {
  if (!isRecord(error)) return "unknown_error";
  const name = typeof error.name === "string" ? error.name.slice(0, 80) : "Error";
  const status = isRecord(error.$metadata) && typeof error.$metadata.httpStatusCode === "number"
    ? `:${error.$metadata.httpStatusCode}`
    : "";
  const message = typeof error.message === "string"
    ? error.message.replace(/\s+/gu, " ").slice(0, 240)
    : "";
  return `${name}${status}${message ? ` ${message}` : ""}`;
}
