import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { accommodationToolDescriptor } from "@raiquora/agent/accommodation-tool-descriptor";
import type { AgentRuntimeContextInput } from "@raiquora/agent/agent-decision-context";
import type { AgentTrace } from "@raiquora/agent/agent-trace";
import { externalTravelToolDescription, externalTravelToolInputSchema } from "@raiquora/agent/external-travel-tools";
import type { AgentEvaluationCaseResult, AgentEvaluationDataset, AgentEvaluationReport, ConversationQualityScenario } from "../frontend/src/usecases/agent/evaluation/evaluation-contract";
import { parseAgentEvaluationDataset } from "../frontend/src/usecases/agent/evaluation/evaluation-dataset";
import { evaluateConversationQualityLive, type ConversationQualityLiveResult, type ConversationQualityLiveTurn } from "../frontend/src/usecases/agent/evaluation/conversation-quality-live";
import { liveEvaluationAccommodationOutput, liveEvaluationPhotoCount, liveEvaluationToolEvidence, liveEvaluationTravelToolOutput,
  type LiveEvaluationPlace, type LiveEvaluationTravelToolName } from "../frontend/src/usecases/agent/evaluation/live-model-tool-fixture";
import { AwsBedrockConverseClient } from "../backend/agent-api/src/adapters/aws-sdk-clients";
import { BedrockConversationModel } from "../backend/agent-api/src/adapters/bedrock-conversation-model";
import { agentSystemPrompt } from "../backend/agent-api/src/usecases/agent-system-prompt";
import { createServerAgent } from "../backend/agent-api/src/server-agent-composition";
import type { ServerAgentToolBinding } from "../backend/agent-api/src/usecases/agent/server-tools";

const root = resolve(import.meta.dirname, "..");
const strategy = argument("--strategy") ?? "live-model";
const repetitions = positiveIntegerArgument("--repetitions", 1, 5);
const outputDirectory = resolve(argument("--output-dir") ?? `/tmp/raiquora-live-agent-eval/${strategy}`);
const datasetPath = resolve(argument("--dataset") ?? `${root}/tests/fixtures/agent-eval-cases.json`);
const dataset = parseAgentEvaluationDataset(JSON.parse(await readFile(datasetPath, "utf8")));
const scenarios = selectedScenarios(dataset, argument("--case"));
const modelId = process.env.MODEL_ID?.trim() || "amazon.nova-lite-v1:0";
const decisionModelId = process.env.DECISION_MODEL_ID?.trim() || "jp.amazon.nova-2-lite-v1:0";
const model = new BedrockConversationModel(new AwsBedrockConverseClient(), {
  modelId,
  decisionModelId,
  systemPrompt: agentSystemPrompt,
  timeoutMs: 80_000,
});
const attempts: Array<{ attempt: number; results: ConversationQualityLiveResult[]; conversations: LiveConversationRecord[] }> = [];
const traces: AgentTrace[] = [];

for (let attempt = 1; attempt <= repetitions; attempt += 1) {
  const results: ConversationQualityLiveResult[] = [], conversations: LiveConversationRecord[] = [];
  for (const scenario of scenarios) {
    const liveTurns: ConversationQualityLiveTurn[] = [], history: Array<{ role: "user" | "assistant"; text: string }> = [];
    const turnTraces: AgentTrace[] = [];
    for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex += 1) {
      const turn = scenario.turns[turnIndex]!;
      const observedOutputs: unknown[] = [];
      const executionId = `${strategy}-${scenario.id}-${attempt}-${turnIndex + 1}`;
      const application = createServerAgent({
        model,
        weather: { search: async () => ({ status: "unavailable", freshness: "unknown", evidence: [],
          failure: { code: "unavailable", message: "live-eval-fixture", retryable: false } }) },
        additionalTools: evaluationTools(scenario, observedOutputs),
        newExecutionId: () => executionId,
        loadContext: async () => scenarioContext(scenario, turnIndex, history),
        // Candidate discovery, page reading, POI/photo resolution and final rendering are
        // distinct model decisions. Match the production Tool budget so the benchmark does
        // not force finalization halfway through that supported flow.
        limits: { maxIterations: 5, maxModelCalls: 5, maxToolCalls: 8, maxExecutionMs: 90_000 },
      });
      const result = await application.runAgentTurn({
        principal: { subject: "live-eval", identity: { issuer: "live-eval", subject: "live-eval" }, scopes: [] },
        userRequest: turn.text,
        conversationId: scenario.id,
        uiContext: { calendarDate: scenario.fixedNow.slice(0, 10) },
      });
      const toolNames = result.trace.events.flatMap((event) => event.type === "tool_called" ? [event.toolName] : []);
      liveTurns.push({ response: result.response, toolNames, photoCount: liveEvaluationPhotoCount(observedOutputs) });
      history.push({ role: "user", text: turn.text }, { role: "assistant", text: result.response });
      turnTraces.push(result.trace);
    }
    const quality = evaluateConversationQualityLive(scenario, liveTurns);
    results.push(quality);
    conversations.push({ scenarioId: scenario.id, turns: scenario.turns.map((turn, index) => ({
      user: turn.text,
      assistant: liveTurns[index]!.response,
      tools: liveTurns[index]!.toolNames,
      photoCount: liveTurns[index]!.photoCount,
    })) });
    traces.push(mergeTraces(`${strategy}-${scenario.id}-${attempt}`, turnTraces));
  }
  attempts.push({ attempt, results, conversations });
}

const report = stableReport(attempts, scenarios);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(`${outputDirectory}/agent-eval-report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(`${outputDirectory}/agent-eval-report.md`, renderReport(strategy, repetitions, modelId, decisionModelId, attempts, report), "utf8"),
  writeFile(`${outputDirectory}/agent-eval-traces.json`, `${JSON.stringify(traces, null, 2)}\n`, "utf8"),
  writeFile(`${outputDirectory}/conversation-quality-attempts.json`, `${JSON.stringify(attempts, null, 2)}\n`, "utf8"),
  writeFile(`${outputDirectory}/run-manifest.json`, `${JSON.stringify({
    schemaVersion: "agent-live-model-eval-manifest-v1", strategy, repetitions, modelId, decisionModelId,
    datasetSchemaVersion: dataset.schemaVersion, scenarioIds: scenarios.map(({ id }) => id), executedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8"),
]);
console.log(`Live Agent Model Eval (${strategy}, ${repetitions}x): ${report.passedCaseCount}/${report.caseCount} stable (${outputDirectory})`);
if (process.argv.includes("--require-all") && report.passedCaseCount !== report.caseCount) process.exitCode = 1;

interface LiveConversationRecord {
  scenarioId: string;
  turns: Array<{ user: string; assistant: string; tools: string[]; photoCount: number }>;
}

function selectedScenarios(dataset: AgentEvaluationDataset, selected?: string): ConversationQualityScenario[] {
  const scenarios = (dataset.conversationQualityScenarios ?? []).filter(({ tags, id }) =>
    tags.includes("feedback-regression") && (selected === undefined || id === selected));
  if (!scenarios.length) throw new Error("対象となる会話品質Live Eval scenarioがありません");
  return scenarios;
}

function scenarioContext(
  scenario: ConversationQualityScenario,
  turnIndex: number,
  history: Array<{ role: "user" | "assistant"; text: string }>,
): AgentRuntimeContextInput {
  const calendarDate = scenario.fixedNow.slice(0, 10), startDate = scenario.expected.relativeDates[0]?.calendarDate;
  const destination = scenario.expected.destination;
  const specified = destination.mode === "specified";
  const destinationName = destination.mode === "specified" ? destination.name : undefined;
  const oneNight = scenario.id === "feedback-izumo-one-night-no-questionnaire";
  const dateKnown = oneNight || turnIndex >= 1 || !specified;
  const tripContext: Record<string, string | number> = {
    planningStage: specified && dateKnown ? "planning" : "inspiration",
    ...(destinationName ? { destinationWish: destinationName } : {}),
    ...(dateKnown && startDate ? { startDate } : {}),
    ...(oneNight && startDate ? { endDate: addDays(startDate, 1), stayNights: 1 } : {}),
  };
  const knownHardConstraints = [
    ...(destinationName ? [{ key: "destination", value: destinationName, source: "trip_context" as const }] : []),
    ...(dateKnown && startDate ? [{ key: "start_date", value: startDate, source: "trip_context" as const }] : []),
    ...(oneNight ? [{ key: "stay_nights", value: 1, source: "trip_context" as const }] : []),
  ];
  return {
    featureContext: { calendarDate, serviceDate: calendarDate },
    conversation: { title: scenario.name, scope: "general", messages: structuredClone(history) },
    tripContext,
    knownHardConstraints,
    verifiedFacts: [{
      evidenceId: "live-eval-service-coverage", category: "journey", subject: "収録済み交通範囲",
      summary: "収録済みの駅・時刻表は西日本を中心とし、城崎温泉、おごと温泉、有馬温泉、出雲市方面を含む。熱海・伊東・東京・北海道はこの評価の主候補範囲外。",
      knowledgeKind: "deterministic_fact", sourceType: "timetable-index", freshness: "scheduled", coverage: ["rail.schedule"],
    }],
  };
}

function evaluationTools(scenario: ConversationQualityScenario, outputs: unknown[]): ServerAgentToolBinding[] {
  const names = ["search_place_media", "search_web", "read_web_pages", "resolve_place_candidates"] as const;
  return [
    ...names.map((name): ServerAgentToolBinding => ({
      descriptor: { name, description: externalTravelToolDescription(name), inputSchema: externalTravelToolInputSchema(name) },
      operation: async input => {
        const output = toolOutput(name, input, scenario); outputs.push(output); return { body: output };
      },
      evidence: liveEvaluationToolEvidence,
    })),
    {
      descriptor: accommodationToolDescriptor,
      operation: async input => { const output = liveEvaluationAccommodationOutput(input); outputs.push(output); return { body: output }; },
      evidence: liveEvaluationToolEvidence,
    },
  ];
}

function toolOutput(name: LiveEvaluationTravelToolName, input: Record<string, unknown>, scenario: ConversationQualityScenario): Record<string, unknown> {
  const places = scenario.expected.destination.mode === "specified" ? [izumoPlace()] : candidatePlaces();
  return liveEvaluationTravelToolOutput({ name, query: input, places, retrievedAt: scenario.fixedNow });
}

function izumoPlace(): LiveEvaluationPlace {
  return { providerPlaceId: "live.izumo-taisha", name: "出雲大社", municipality: "出雲市", sourceUrl: "https://example.com/izumo-taisha",
    photoUrl: "https://images.example.com/izumo-taisha.jpg", overview: "出雲市にある神社。参拝と門前町散策を組み合わせられる。" };
}

function candidatePlaces(): LiveEvaluationPlace[] {
  return [
    { providerPlaceId: "live.kinosaki", name: "城崎温泉", municipality: "豊岡市", sourceUrl: "https://example.com/kinosaki", photoUrl: "https://images.example.com/kinosaki.jpg", overview: "城崎温泉は外湯と温泉街の散策をゆっくり楽しめる。収録済み鉄道駅からアクセスできる。" },
    { providerPlaceId: "live.ogoto", name: "おごと温泉", municipality: "大津市", sourceUrl: "https://example.com/ogoto", photoUrl: "https://images.example.com/ogoto.jpg", overview: "おごと温泉は琵琶湖畔で温泉と滞在をゆっくり楽しめる。収録済み鉄道駅からアクセスできる。" },
    { providerPlaceId: "live.arima", name: "有馬温泉", municipality: "神戸市", sourceUrl: "https://example.com/arima", photoUrl: "https://images.example.com/arima.jpg", overview: "有馬温泉は歴史ある温泉街と滞在をゆっくり楽しめる。収録済み鉄道駅からアクセスできる。" },
  ];
}

function stableReport(
  attempts: Array<{ results: ConversationQualityLiveResult[] }>,
  scenarios: readonly ConversationQualityScenario[],
): AgentEvaluationReport {
  const cases = scenarios.map((scenario, index): AgentEvaluationCaseResult => {
    const results = attempts.map(({ results }) => results[index]!);
    const representative = [...results].sort((left, right) => qualityTotal(left) - qualityTotal(right))[0]!;
    return { id: scenario.id, name: scenario.name, passed: results.every(({ passed }) => passed), metrics: representative.metrics,
      failures: [...new Set(results.flatMap(({ failures }) => failures))] };
  });
  return {
    schemaVersion: "agent-eval-report-v4",
    datasetSchemaVersion: "agent-eval-dataset-v4",
    caseCount: cases.length,
    passedCaseCount: cases.filter(({ passed }) => passed).length,
    metrics: aggregate(cases),
    categories: [],
    cases,
  };
}

function qualityTotal(result: ConversationQualityLiveResult): number {
  const metrics = result.metrics;
  return metrics.toolSelectionAccuracy + metrics.constraintSatisfaction + (metrics.groundedClaimRate ?? 1) +
    (1 - (metrics.unsupportedClaimRate ?? 0)) + metrics.taskCompletion;
}

function aggregate(cases: readonly AgentEvaluationCaseResult[]): AgentEvaluationReport["metrics"] {
  const value = (key: "toolSelectionAccuracy" | "constraintSatisfaction" | "taskCompletion") =>
    cases.reduce((sum, item) => sum + item.metrics[key], 0) / cases.length;
  const nullable = (key: "groundedClaimRate" | "unsupportedClaimRate") => {
    const values = cases.flatMap((item) => item.metrics[key] === null ? [] : [item.metrics[key]] as number[]);
    return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
  };
  return { toolSelectionAccuracy: value("toolSelectionAccuracy"), constraintSatisfaction: value("constraintSatisfaction"),
    groundedClaimRate: nullable("groundedClaimRate"), unsupportedClaimRate: nullable("unsupportedClaimRate"), taskCompletion: value("taskCompletion") };
}

function mergeTraces(executionId: string, traces: readonly AgentTrace[]): AgentTrace {
  return { executionId, droppedEventCount: traces.reduce((sum, trace) => sum + trace.droppedEventCount, 0),
    events: traces.flatMap(({ events }) => events).map((event, index) => ({ ...event, sequence: index + 1 })) };
}

function renderReport(
  name: string,
  count: number,
  defaultModel: string,
  decisionModel: string,
  attempts: Array<{ attempt: number; results: ConversationQualityLiveResult[]; conversations: LiveConversationRecord[] }>,
  report: AgentEvaluationReport,
): string {
  const lines = [
    `# Live Agent Model Evaluation: ${name}`,
    "",
    `- Default model: \`${defaultModel}\``,
    `- Decision model: \`${decisionModel}\``,
    `- Repetitions: ${count}`,
    `- Stable cases: ${report.passedCaseCount}/${report.caseCount}`,
    "",
    "| Case | Stable | Tool | Constraint | Grounded | Unsupported | Completion |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.cases.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${percent(item.metrics.toolSelectionAccuracy)} | ${percent(item.metrics.constraintSatisfaction)} | ${nullablePercent(item.metrics.groundedClaimRate)} | ${nullablePercent(item.metrics.unsupportedClaimRate)} | ${percent(item.metrics.taskCompletion)} |`),
  ];
  for (const attempt of attempts) {
    lines.push("", `## Attempt ${attempt.attempt}`);
    for (const conversation of attempt.conversations) {
      lines.push("", `### ${conversation.scenarioId}`);
      conversation.turns.forEach((turn, index) => lines.push("", `#### Turn ${index + 1}`, "", `User: ${turn.user}`, "", `Tools: ${turn.tools.join(" → ") || "none"}; photos=${turn.photoCount}`, "", turn.assistant));
    }
  }
  return `${lines.join("\n")}\n`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function nullablePercent(value: number | null): string { return value === null ? "n/a" : percent(value); }
function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function positiveIntegerArgument(name: string, fallback: number, maximum: number): number {
  const raw = argument(name); if (raw === undefined) return fallback; const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name}は1から${maximum}の整数で指定してください`);
  return value;
}
