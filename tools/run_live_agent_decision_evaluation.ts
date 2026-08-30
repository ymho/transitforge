import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AwsBedrockConverseClient } from "../backend/agent-api/src/adapters/aws-sdk-clients";
import { BedrockConversationModel } from "../backend/agent-api/src/adapters/bedrock-conversation-model";
import { agentSystemPrompt } from "../backend/agent-api/src/usecases/agent-system-prompt";
import {
  ConverseModelProvider,
  viewerAgentToolDescriptors,
  type BedrockAgentConverse,
  type ViewerAgentToolName,
} from "../frontend/src/adapters/bedrock/viewer-agent-runtime";
import { AgentToolExecutor } from "../frontend/src/usecases/agent/agent-tool-executor";
import { MultiStepAgentRuntime } from "../frontend/src/usecases/agent/agent-runtime";
import type { AgentRuntimeContextInput } from "../frontend/src/usecases/agent/agent-decision-context";
import { observeAgentRuntimeResult, evaluateAgentDataset } from "../frontend/src/usecases/agent/evaluation/agent-evaluator";
import type {
  AgentEvaluationCase,
  AgentEvaluationDataset,
  AgentEvaluationObservation,
} from "../frontend/src/usecases/agent/evaluation/evaluation-contract";
import { renderAgentEvaluationMarkdown } from "../frontend/src/usecases/agent/evaluation/evaluation-report";
import type { AgentModelClass } from "../frontend/src/usecases/agent/model-provider";
import {
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentTool,
} from "../frontend/src/usecases/agent/tool-contract";
import { ToolEvidenceRegistry } from "../frontend/src/usecases/agent/tool-evidence-registry";
import { AgentToolRegistry } from "../frontend/src/usecases/agent/tool-registry";

interface LiveDecisionCase {
  evaluation: AgentEvaluationCase;
  context: AgentRuntimeContextInput;
  availableTools: ViewerAgentToolName[];
}

const modelClass = parseModelClass(argument("--model-class") ?? "default");
const profile = argument("--profile") ?? "smoke";
if (profile !== "smoke" && profile !== "full") {
  throw new Error("--profileはsmokeまたはfullで指定してください");
}
const strategy = argument("--strategy") ?? `single-${modelClass}`;
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

const observations: AgentEvaluationObservation[] = [];
const traces = [];
for (const item of cases) {
  const registry = evaluationToolRegistry(item.availableTools);
  const runtime = new MultiStepAgentRuntime({
    model: new ConverseModelProvider(converse),
    modelClass,
    tools: registry,
    toolExecutor: new AgentToolExecutor(registry, new ToolEvidenceRegistry()),
    // この評価は最初の能力選択だけを測る。Domain結果後の再計画はRuntimeの
    // integration testと別のLive Evalで扱い、架空の事実をモデルへ返さない。
    terminalToolResult: (toolName) => `Live Evalで${toolName}の選択を確認しました`,
    limits: { maxIterations: 2, maxModelCalls: 2, maxToolCalls: 2, maxExecutionMs: 60_000 },
  });
  const result = await runtime.run({
    executionId: `live-eval-${item.evaluation.id}-${crypto.randomUUID()}`,
    feature: item.evaluation.feature,
    userRequest: item.evaluation.userRequest,
    context: item.context,
  });
  observations.push(observeAgentRuntimeResult(item.evaluation.id, result));
  traces.push(result.trace);
}

const dataset: AgentEvaluationDataset = {
  schemaVersion: "agent-eval-dataset-v1",
  cases: cases.map(({ evaluation }) => evaluation),
};
const report = evaluateAgentDataset(dataset, {
  schemaVersion: "agent-eval-observations-v1",
  observations,
});
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(`${outputDirectory}/agent-eval-report.json`, `${JSON.stringify(report, null, 2)}\n`),
  writeFile(`${outputDirectory}/agent-eval-report.md`, renderAgentEvaluationMarkdown(report)),
  writeFile(`${outputDirectory}/agent-eval-traces.json`, `${JSON.stringify(traces, null, 2)}\n`),
]);
console.log(
  `Live Agent Decision Eval (${strategy}): ${report.passedCaseCount}/${report.caseCount} passed ` +
  `(${outputDirectory})`,
);
if (modelFailures.length > 0) {
  console.error(`Bedrock failures: ${[...new Set(modelFailures)].join(" / ")}`);
}
if (report.passedCaseCount !== report.caseCount) process.exitCode = 1;

function evaluationToolRegistry(names: ViewerAgentToolName[]): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  for (const descriptor of viewerAgentToolDescriptors(names)) {
    const tool: AgentTool<Record<string, unknown>, Record<string, unknown>> = {
      ...descriptor,
      parseInput(value) {
        return isRecord(value)
          ? validAgentToolInput(value)
          : { ok: false, error: { code: "invalid_input", message: "object required", retryable: false } };
      },
      async execute(input) {
        return successfulAgentToolResult({
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
  ];
}

function liveCase(input: {
  id: string;
  name: string;
  userRequest: string;
  tags: string[];
  expectedTool: ViewerAgentToolName;
  constraints: Record<string, string | number | boolean | string[]>;
  requiredHardConstraintKeys: string[];
  context: AgentRuntimeContextInput;
  availableTools: ViewerAgentToolName[];
}): LiveDecisionCase {
  return {
    evaluation: {
      id: input.id,
      name: input.name,
      feature: "concierge",
      userRequest: input.userRequest,
      tags: input.tags,
      expected: {
        toolSequence: [input.expectedTool],
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeFailure(error: unknown): string {
  if (!isRecord(error)) return "unknown_error";
  const name = typeof error.name === "string" ? error.name.slice(0, 80) : "Error";
  const status = isRecord(error.$metadata) && typeof error.$metadata.httpStatusCode === "number"
    ? `:${error.$metadata.httpStatusCode}`
    : "";
  return `${name}${status}`;
}
