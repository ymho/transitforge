import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AwsBedrockConverseClient } from "../backend/agent-api/src/adapters/aws-sdk-clients";
import { BedrockConversationModel } from "../backend/agent-api/src/adapters/bedrock-conversation-model";
import { agentSystemPrompt } from "../backend/agent-api/src/usecases/agent-system-prompt";
import { weatherGeocodingLocation } from "../backend/agent-api/src/adapters/weather-geocoding-location";
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
import { createAgentContextSnapshot } from "../frontend/src/usecases/agent/agent-context-snapshot";
import { createTrip } from "../modules/trip/domain/trip";
import type { TripRequest } from "../modules/trip/domain/trip-request";
import { progressCaseIds, runAskProgressCase } from "../frontend/src/adapters/bedrock/ask-progress-scenarios.fixture";
import { runTravelProgressScenario } from "../frontend/src/adapters/bedrock/travel-progress-scenarios.fixture";
import { renderTravelProgressMarkdown } from "../frontend/src/usecases/agent/evaluation/travel-progress-evaluation";
import { parseAgentEvaluationDataset } from "../frontend/src/usecases/agent/evaluation/evaluation-dataset";

interface LiveDecisionCase {
  evaluation: AgentEvaluationCase;
  context: AgentRuntimeContextInput;
  availableTools: ViewerAgentToolName[];
  toolOutcomes?: Partial<Record<ViewerAgentToolName, Record<string, unknown>>>;
  expectedToolInputs?: Partial<Record<ViewerAgentToolName, Record<string, unknown>>>;
  terminalTools?: ViewerAgentToolName[];
  terminalAfterCalls?: number;
  maxModelCalls?: number;
  toolInputChecks?: Array<{ toolName: ViewerAgentToolName; callIndex: number; field: string; pattern: string; allowMissing?: boolean; normalization?: "weather-municipality" }>;
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
const maxOutputTokens = positiveIntegerArgument("--max-output-tokens", 4_096, 5_000);
const outputDirectory = resolve(
  argument("--output-dir") ?? `/tmp/raiquora-live-agent-eval/${strategy}`,
);
const selectedCase = argument("--case");
const progressSuite = argument("--suite") === "ask-progress";
const tripProgressSuite = argument("--suite") === "trip-progress";
const cases = liveDecisionCases().filter(({ evaluation }) =>
  (profile === "full" || evaluation.tags.includes("smoke")) &&
  (selectedCase === undefined || evaluation.id === selectedCase));
if (cases.length === 0 && !progressSuite && !tripProgressSuite) throw new Error("対象となるLive Eval caseがありません");
// Only scalar request/response diagnostics, never provider payloads or model reasoning.
const provider = new AwsBedrockConverseClient();
const providerAttempts: Record<string, unknown>[] = [];
let modelCallNumber = 0;
const model = new BedrockConversationModel({ converse: async (input) => {
  const specs = (input.toolConfig as { tools?: { toolSpec: { description: string } }[] } | undefined)?.tools ?? [];
  const diagnostic: Record<string, unknown> = { modelCallNumber, toolCount: specs.length,
    toolDescriptorCharacters: specs.reduce((n, s) => n + s.toolSpec.description.length, 0),
    inputTokens: null, inputTokenSource: "unavailable", providerRetry: 0 };
  const metadata = (value: unknown) => {
    const v = value as { $metadata?: { httpStatusCode?: number; requestId?: string }; usage?: { inputTokens?: number } } | undefined;
    if (Number.isFinite(v?.$metadata?.httpStatusCode)) diagnostic.httpStatus = v!.$metadata!.httpStatusCode;
    if (typeof v?.$metadata?.requestId === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(v.$metadata.requestId)) diagnostic.providerRequestId = v.$metadata.requestId;
    if (Number.isFinite(v?.usage?.inputTokens)) { diagnostic.inputTokens = v!.usage!.inputTokens; diagnostic.inputTokenSource = "provider_usage"; }
  };
  try {
    const value = await provider.converse(input); metadata(value);
    diagnostic.status = "success"; return value;
  } catch (error) {
    metadata(error); diagnostic.status = "failure";
    diagnostic.providerErrorName = error instanceof Error && /^[a-zA-Z0-9]+$/.test(error.name) ? error.name : "UnknownError";
    if (process.argv.includes("--measure-input-tokens")) {
      try {
        const tokens = await provider.countTokens(input);
        if (Number.isFinite(tokens)) { diagnostic.inputTokens = tokens; diagnostic.inputTokenSource = "CountTokens"; }
      } catch { diagnostic.inputTokenSource = "CountTokens_unavailable"; }
    }
    throw error;
  } finally { providerAttempts.push(diagnostic); }
} }, {
  maxOutputTokens,
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
  modelCallNumber++;
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
if (tripProgressSuite) {
  const dataset = parseAgentEvaluationDataset(JSON.parse(await readFile(new URL("../tests/fixtures/agent-eval-cases.json", import.meta.url), "utf8")));
  const scenarios = (dataset.travelProgressScenarios ?? []).filter((s) => selectedCase ? selectedCase === s.id : profile === "full" || s.tags.includes("smoke"));
  if (!scenarios.length) throw new Error("Unknown Trip Progress case");
  const results = [];
  for (let attempt = 1; attempt <= repetitions; attempt++) {
    for (const scenario of scenarios) {
      // Same production Runtime and synthetic provider fixtures as scripted evaluation.
      // The real model receives history and Request; only public structured observations are reported.
      providerAttempts.length = 0; modelCallNumber = 0;
      results.push({ ...await runTravelProgressScenario(scenario, converse), attempt, providerAttempts: [...providerAttempts] });
      console.log(`Trip Progress live: ${scenario.id}, attempt ${attempt}`);
      if (modelFailures.length) break;
    }
    if (modelFailures.length) break;
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(`${outputDirectory}/trip-progress-live.json`, JSON.stringify({
    results, modelFailures: modelFailures.length, incomplete: modelFailures.length > 0,
    plannedCases: scenarios.map((s) => s.id), repetitions,
  }, null, 2) + "\n");
  await writeFile(`${outputDirectory}/trip-progress-live.md`, renderTravelProgressMarkdown(results) +
    (modelFailures.length ? "\n実モデル呼出し失敗により評価は未完了。認証/Providerの状態を確認して再実行する。\n" : ""));
  console.log(`Trip Progress live: ${results.filter((r) => r.passed).length}/${results.length} within thresholds (${outputDirectory})`);
  // Fine turn differences warn, not mandatory CI. Provider failures are an incomplete run, not success.
  if (modelFailures.length) console.error(modelFailures.join("\n"));
  process.exit(modelFailures.length || results.some((r) => r.contractFailures.length) ? 1 : 0);
}
if (progressSuite) {
  const ids = progressCaseIds.filter((id) => selectedCase ? selectedCase === id : profile === "full" || id === "A-vague" || id === "G-consecutive");
  if (!ids.length) throw new Error("Unknown Ask + Progress case");
  const results = [];
  for (let attempt = 1; attempt <= repetitions; attempt += 1) {
    for (const id of ids) {
      // Real production registry/presenter/policy, not the tool-selection-only terminal shortcut below.
      const result = await runAskProgressCase(id, converse);
      results.push({ id, attempt, observation: result.observation, failures: result.failures, modelCalls: result.calls,
        response: result.response, trace: result.trace });
    }
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(`${outputDirectory}/ask-progress-live.json`, JSON.stringify({ results, modelFailures }, null, 2));
  console.log(`Ask + Progress live: ${results.filter((r) => !r.failures.length).length}/${results.length} passed (${outputDirectory})`);
  if (modelFailures.length) console.error(modelFailures.join("\n"));
  process.exit(results.some((r) => r.failures.length) || modelFailures.length ? 1 : 0);
}
const traces = [];
for (let attempt = 1; attempt <= repetitions; attempt += 1) {
  const observations: AgentEvaluationObservation[] = [];
  for (const item of cases) {
    let completedToolCalls = 0;
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
      terminalToolResult: (toolName) => ++completedToolCalls >= (item.terminalAfterCalls ?? 1) &&
        (item.terminalTools ?? item.availableTools).includes(toolName as ViewerAgentToolName)
        ? `Live Evalで${toolName}の選択を確認しました`
        : undefined,
      // Reserve a final-answer call after the two Tool steps evaluated by replan cases.
      // A two-call budget forces finalization before the second Tool can be selected.
      limits: { maxIterations: item.maxModelCalls ?? 3, maxModelCalls: item.maxModelCalls ?? 3, maxToolCalls: item.maxModelCalls ?? 3, maxExecutionMs: item.maxModelCalls ? 90_000 : 60_000 },
    });
    const result = await runtime.run({
      executionId: `live-eval-${item.evaluation.id}-attempt-${attempt}-${crypto.randomUUID()}`,
      feature: item.evaluation.feature,
      userRequest: item.evaluation.userRequest,
      context: item.context,
    });
    const observation = observeAgentRuntimeResult(item.evaluation.id, result);
    for (const [index, check] of (item.toolInputChecks ?? []).entries()) {
      const call = result.trace.events.filter((event) => event.type === "tool_called" && event.toolName === check.toolName)[check.callIndex];
      const rawValue = call?.type === "tool_called" && isRecord(call.input.value) ? call.input.value[check.field] : undefined;
      // Evaluate the same effective city-level input the production adapter uses.
      // Keep the original input in Trace; never feed a grading failure to the model.
      const value = check.normalization === "weather-municipality" && typeof rawValue === "string"
        ? weatherGeocodingLocation(rawValue) : rawValue;
      observation.normalizedConstraints[`tool_input_check_${index}`] = call !== undefined &&
        (value === undefined && check.allowMissing === true || typeof value === "string" && new RegExp(check.pattern, "u").test(value));
    }
    observations.push(observation);
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
  `output budget=${maxOutputTokens}, ` +
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
  const v2Request: TripRequest = {
    constraints: [
      { id: "destination", strength: "hard", source: "user", scope: { type: "trip" }, requirement: { type: "destinations", places: [{ name: "京都市", sources: [] }], order: "fixed" } },
      { id: "dates", strength: "hard", source: "user", scope: { type: "trip" }, requirement: { type: "dates", start: { earliest: "2026-09-21", latest: "2026-09-21" } } },
      { id: "old-destination", strength: "hard", source: "assumption", assumptionId: "rejected", scope: { type: "trip" }, requirement: { type: "destinations", places: [{ name: "那覇市", sources: [] }], order: "fixed" } },
    ],
    assumptions: [{ id: "rejected", text: "那覇を仮の行き先としていた", status: "rejected", source: "model", affects: [{ type: "constraint", constraintId: "old-destination" }] }],
  };
  const v2Trip = createAgentContextSnapshot(undefined, createTrip("11111111-1111-4111-8111-111111111111", "旅行", "2026-09-12T08:00:00Z", [], v2Request)).trip;
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
    ...(["search_web", "search_weather_forecast"] as const).map((tool) => liveCase({
      id: `trip-v2-state-free-${tool}`,
      name: `同じcandidate_discoveryでも要求に沿って${tool}を選ぶ`,
      userRequest: tool === "search_web" ? "今回の行き先の静かな散策スポットをWeb検索してください" : "この旅行先の旅行日の天気を調べてください",
      tags: ["trip-v2", "planning-state", "tool-selection"], expectedTool: tool,
      constraints: {}, requiredHardConstraintKeys: [],
      context: { currentTrip: { ...v2Trip, planningState: "candidate_discovery", lifecycleState: "pre_trip" },
        featureContext: { calendarDate: "2026-09-20", serviceDate: "2026-09-20" } },
      availableTools: ["search_web", "search_weather_forecast", "ask_follow_up"],
      toolInputChecks: tool === "search_web"
        ? [{ toolName: tool, callIndex: 0, field: "query", pattern: "京都" }]
        : [{ toolName: tool, callIndex: 0, field: "startDate", pattern: "^2026-09-21$" }],
    })),
    liveCase({
      id: "trip-v2-known-request-weather",
      name: "V2の既知旅行先・日程を使い、legacy日程を再利用/再質問しない",
      userRequest: "この旅行先の旅行日の天気を調べてください",
      tags: ["constraint", "trip-v2", "known-condition"], expectedTool: "search_weather_forecast",
      constraints: {}, requiredHardConstraintKeys: [],
      context: { currentTrip: v2Trip, featureContext: { calendarDate: "2026-09-20", serviceDate: "2026-09-20" },
        tripContext: { destinationWish: "那覇市", startDate: "2020-01-01" } },
      availableTools: ["search_weather_forecast", "ask_follow_up"],
      toolInputChecks: [
        { toolName: "search_weather_forecast", callIndex: 0, field: "location", pattern: "^京都市$", normalization: "weather-municipality" },
        { toolName: "search_weather_forecast", callIndex: 0, field: "startDate", pattern: "^2026-09-21$" },
      ],
    }),
    liveCase({
      id: "trip-v2-rejected-assumption-search",
      name: "却下した行き先や普段の嗜好より今回の行き先を検索に使う",
      userRequest: "今回の行き先の静かな散策スポットをWeb検索してください",
      tags: ["constraint", "trip-v2", "assumption"], expectedTool: "search_web",
      constraints: {}, requiredHardConstraintKeys: [],
      context: { currentTrip: v2Trip, travelProfile: { favoriteInterests: ["沖縄の海"] } },
      availableTools: ["search_web", "ask_follow_up"],
      toolInputChecks: [{ toolName: "search_web", callIndex: 0, field: "query", pattern: "^(?!.*(?:那覇|沖縄)).*京都" }],
    }),
    liveCase({
      id: "regional-request-without-exact-origin",
      name: "地域だけの相談を正確な出発地の質問で止めない",
      userRequest: "大阪市で半日、景色のいい所をのんびり歩きたい。細かい場所はまだ決めていません",
      tags: ["feedback-regression", "provisional-planning"],
      expectedTool: "search_web", constraints: {}, requiredHardConstraintKeys: [],
      context: { featureContext, tripContext: { planningStage: "inspiration" } },
      availableTools: ["search_web", "search_place_media", "ask_follow_up"],
      toolInputChecks: [{ toolName: "search_web", callIndex: 0, field: "query", pattern: "大阪" }],
    }),
    liveCase({
      id: "approximate-place-description-discovery",
      name: "正確な施設名を利用者に答えさせず手掛かりから検索する",
      userRequest: "名前が思い出せないのですが、神戸の海辺にある赤い塔を見たいです。どんな所ですか",
      tags: ["feedback-regression", "provisional-planning"],
      expectedTool: "search_web", constraints: {}, requiredHardConstraintKeys: [],
      context: { featureContext },
      availableTools: ["search_web", "ask_follow_up"],
      toolInputChecks: [{ toolName: "search_web", callIndex: 0, field: "query", pattern: "神戸" }],
    }),
    liveCase({
      id: "regional-provisional-origin-route",
      name: "未確定の出発駅を現地の仮起点として明示して経路を調べる",
      userRequest: "駅名は分かりません。神戸市内の代表的な駅を仮の起点にして、明日の朝9時から大阪までの経路を見たいです",
      tags: ["feedback-regression", "provisional-planning"],
      expectedTool: "search_direct_routes", constraints: {}, requiredHardConstraintKeys: [],
      context: { featureContext, tripContext: { planningStage: "planning", destinationWish: "大阪", startDate: "2026-08-31", stayNights: 0 },
        verifiedFacts: [{ evidenceId: "fixture:station", category: "station", subject: "神戸・大阪", summary: "時刻表に神戸駅、三ノ宮駅、大阪駅を収録。神戸駅と三ノ宮駅は神戸市内の駅。" }],
      },
      availableTools: ["search_direct_routes", "search_web", "ask_follow_up"],
      toolInputChecks: [{ toolName: "search_direct_routes", callIndex: 0, field: "provisionalOriginStation", pattern: "神戸|三ノ宮|三宮|元町" }],
    }),
    liveCase({
      id: "nearby-search-geographic-mismatch",
      name: "近場検索に別地域が混ざったら地域を照合して再探索する",
      userRequest: "向日町駅から近場で、のんびり海や自然を感じる旅がしたい",
      tags: ["multi-tool", "feedback-regression", "geographic-relevance"],
      expectedTools: ["search_web", "read_web_pages", "search_web"],
      constraints: {}, requiredHardConstraintKeys: [],
      context: { featureContext, travelProfile: { ...profile, home: { ...profile.home, area: "京都府向日市" } }, tripContext: { planningStage: "inspiration" } },
      availableTools: ["search_web", "read_web_pages", "resolve_place_candidates", "search_place_media", "ask_follow_up"],
      toolOutcomes: { search_web: { webSearch: { status: "available", freshness: "fresh", data: {
        query: "近場の海と自然",
        results: [{ title: "宮崎県日向市の海と自然", url: "https://example.com/miyazaki-hyuga", description: "宮崎県日向市にある海岸の散策スポットを紹介する。" }],
      }, evidence: [] } }, read_web_pages: { webPages: { status: "available", freshness: "fresh", data: {
        pages: [{ url: "https://example.com/miyazaki-hyuga", title: "宮崎県日向市の海と自然", text: "この記事が紹介する場所はいずれも九州の宮崎県日向市にあります。京都府向日市の紹介ではありません。", contentType: "html", truncated: false, untrustedExternalContent: true }],
      }, evidence: [] } } },
      // Search, optional source inspection, and re-search need a fourth call reserved for finalization.
      maxModelCalls: 4, terminalAfterCalls: 2, terminalTools: ["search_web"],
      toolInputChecks: [{ toolName: "search_web", callIndex: 1, field: "query", pattern: "京都|関西|向日市" }],
    }),
    liveCase({
      id: "facility-weather-verified-city",
      name: "施設の天気は確認済み所在地の都市名で照会する",
      userRequest: "明日の二条城の天気を知りたい",
      tags: ["information-gap", "feedback-regression", "weather"],
      expectedTool: "search_weather_forecast", constraints: {}, requiredHardConstraintKeys: [],
      context: { featureContext, tripContext: { planningStage: "planning", destinationWish: "二条城" },
        verifiedFacts: [{ evidenceId: "fixture:nijo", category: "place", subject: "二条城", summary: "所在地は京都府京都市中京区。" }],
      },
      availableTools: ["search_weather_forecast", "search_web", "search_place_media", "ask_follow_up"],
      // Score inputs after execution; do not turn an evaluator's expected answer
      // into a fake Provider error. Omitting dates is a valid seven-day forecast.
      toolInputChecks: [
        { toolName: "search_weather_forecast", callIndex: 0, field: "location", pattern: "^京都市$", normalization: "weather-municipality" },
        { toolName: "search_weather_forecast", callIndex: 0, field: "startDate", pattern: "^2026-08-31$", allowMissing: true },
        { toolName: "search_weather_forecast", callIndex: 0, field: "endDate", pattern: "^2026-08-31$", allowMissing: true },
      ],
    }),
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
      id: "feedback-empty-place-result-bounded-answer",
      name: "候補検索が空でも案内不能にせず確認範囲と次の一手を返す",
      userRequest: "静かに過ごせる観光先を探したい",
      tags: ["smoke", "ambiguous-request", "feedback-regression"],
      expectedTool: "search_web",
      // A bounded result-driven re-query is legitimate; do not prescribe a single
      // fixed plan. More than one re-query or any other Tool still fails.
      alternativeToolSequences: [["search_web", "search_web"]],
      constraints: {},
      requiredHardConstraintKeys: [],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: { planningStage: "inspiration" },
      },
      availableTools: ["search_web"],
      toolOutcomes: {
        search_web: {
          schemaVersion: "live-eval-tool-outcome-v1",
          matchCount: 0,
          limitation: "検証可能な一致地点がありません",
        },
      },
      terminalTools: [],
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
        verifiedFacts: [{
          evidenceId: "place:izumo-taisha",
          category: "place",
          subject: "出雲大社",
          summary: "出雲大社は地図上の具体地点として確認済み",
        }],
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
      tags: ["smoke", "ambiguous-request", "destination-discovery"],
      expectedTool: "search_web",
      constraints: {},
      requiredHardConstraintKeys: [],
      // Viewerは会話開始直後に空のTripContextを渡すことがある。
      // 空objectでも目的地未定の探索として扱えることを本番モデルで測る。
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: {},
        knownSoftPreferences: [{
          key: "usual_origin_station", value: "向日町", source: "travel_profile",
        }],
      },
      availableTools: ["search_web", "search_place_media", "ask_follow_up"],
    }),
    liveCase({
      id: "experience-first-discovery",
      name: "自然を感じたい相談では日程質問や単一POI検索より先に地域候補を調べる",
      userRequest: "静かな海や自然を感じられるところでのんびりしたい",
      tags: ["smoke", "ambiguous-request", "destination-discovery", "profile"],
      expectedTool: "search_web",
      constraints: {},
      requiredHardConstraintKeys: [],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: { planningStage: "inspiration" },
        knownSoftPreferences: [
          { key: "pace", value: "relaxed", source: "travel_profile" },
          { key: "avoid_crowds", value: true, source: "travel_profile" },
        ],
      },
      availableTools: ["search_web", "search_place_media", "ask_follow_up"],
    }),
    liveCase({
      id: "farther-destination-rediscovery",
      name: "もっと遠くという相対希望を既知候補とプロフィール出発地を基準に再探索する",
      userRequest: "もう少し遠くがいい",
      tags: ["smoke", "ambiguous-request", "destination-discovery", "relative-preference"],
      expectedTool: "search_web",
      constraints: {},
      requiredHardConstraintKeys: [],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: { planningStage: "inspiration", destinationWish: "城崎温泉" },
        conversation: {
          summary: "向日町から行く温泉地を比較中",
          relevantMessages: ["城崎温泉と有馬温泉を候補として紹介した"],
          resolvedTopics: [],
          pendingTopics: ["行き先候補の再比較"],
        },
      },
      availableTools: ["search_web", "search_place_media", "ask_follow_up"],
    }),
    liveCase({
      id: "long-conversation-candidate-reference",
      name: "長い候補説明の後でも2番目という参照から写真を検索する",
      userRequest: "2番目の写真を見たい",
      tags: ["conversation", "feedback-regression"],
      expectedTool: "search_place_media",
      constraints: {},
      requiredHardConstraintKeys: [],
      context: {
        featureContext,
        travelProfile: profile,
        tripContext: { planningStage: "inspiration" },
        conversation: { messages: [
          { role: "user", text: "落ち着いて過ごせる海辺の候補をいくつか比較したい" },
          { role: "assistant", text: "移動の負担や現地の過ごし方も含めて考えましょう。".repeat(30) },
          { role: "user", text: "候補を教えて" },
          { role: "assistant", text: "比較する候補は、1. 天橋立、2. 伊根の舟屋、3. 竹野海岸です。気になる場所はありますか?" },
        ] },
      },
      availableTools: ["search_place_media", "search_web", "ask_follow_up"],
      expectedToolInputs: { search_place_media: { query: "伊根の舟屋" } },
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
  alternativeToolSequences?: ViewerAgentToolName[][];
  constraints: Record<string, string | number | boolean | string[]>;
  requiredHardConstraintKeys: string[];
  context: AgentRuntimeContextInput;
  availableTools: ViewerAgentToolName[];
  toolOutcomes?: LiveDecisionCase["toolOutcomes"];
  expectedToolInputs?: LiveDecisionCase["expectedToolInputs"];
  terminalTools?: ViewerAgentToolName[];
  terminalAfterCalls?: LiveDecisionCase["terminalAfterCalls"];
  maxModelCalls?: LiveDecisionCase["maxModelCalls"];
  toolInputChecks?: LiveDecisionCase["toolInputChecks"];
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
        ...(input.alternativeToolSequences ? { alternativeToolSequences: input.alternativeToolSequences } : {}),
        constraints: { ...input.constraints, ...Object.fromEntries((input.toolInputChecks ?? []).map((_, index) => [`tool_input_check_${index}`, true])) },
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
    ...(input.terminalAfterCalls ? { terminalAfterCalls: input.terminalAfterCalls } : {}),
    ...(input.maxModelCalls ? { maxModelCalls: input.maxModelCalls } : {}),
    ...(input.toolInputChecks ? { toolInputChecks: input.toolInputChecks } : {}),
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
