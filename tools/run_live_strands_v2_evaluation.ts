import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";
import { successfulAgentToolResult } from "@raiquora/agent/tool-contract";
import { validateAgentToolInput } from "@raiquora/agent/agent-tool-input-validator";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry, type ToolEvidenceMapper } from "@raiquora/agent/tool-evidence-registry";
import { StrandsAgentEngine } from "../backend/agent-api/src/adapters/strands-agent-engine";
import { createStrandsServerRuntime } from "../backend/agent-api/src/adapters/strands-server-runtime";
import { agentV2SystemPrompt } from "../backend/agent-api/src/usecases/agent-v2-system-prompt";
import { classifyStrandsV2LiveError, evaluateStrandsV2LiveCase, strandsV2LiveCases,
  type StrandsV2LiveCase, type StrandsV2LiveObservation } from "./strands-v2-live-evaluation";

const repetitions = integerArgument("--repetitions", 1, 3);
const selectedId = argument("--case")?.trim();
const outputDirectory = resolve(argument("--output-dir") ?? "/tmp/raiquora-strands-v2-live");
const modelId = process.env.MODEL_ID?.trim() || "amazon.nova-lite-v1:0";
const region = process.env.AWS_REGION?.trim() || "ap-northeast-1";
const cases = selectedId && selectedId !== "all" ? strandsV2LiveCases.filter(({ id }) => id === selectedId) : [...strandsV2LiveCases];
if (!cases.length) throw new Error("Unknown Strands v2 live evaluation case");
const verifiedPlaceInputSchema = { type: "object" as const, properties: { place: { type: "string" as const } },
  required: ["place"], additionalProperties: false };
const limits = { maxIterations: 4, maxModelCalls: 4, maxToolCalls: 1, maxExecutionMs: 60_000, maxEvidence: 8 };
const maximumModelCalls = cases.length * repetitions * limits.maxModelCalls;
let observedModelCalls = 0;
const results: LiveResult[] = [];
const syntheticEvidence: ToolEvidenceMapper = (_output, context): Evidence[] => [{
  id: `evidence:${context.executionId}:kyoto`, category: "external", knowledgeKind: "deterministic_fact", subject: "京都",
  facts: { status: "available", freshness: "fresh", sourceTitle: "京都の確認済み評価資料",
    sourceExcerpt: "京都は評価fixtureで確認済みの旅行先です。", sourceUrl: "https://example.test/strands-v2/kyoto" },
  references: [{ sourceType: "external-source", sourceRef: "https://example.test/strands-v2/kyoto", retrievedAt: context.retrievedAt,
    freshness: "current", summary: "synthetic public evaluation fixture" }],
  observation: { observationId: `observation:${context.toolCallId}`, subjectKey: "place:kyoto", scopeKey: "strands-v2-live",
    predicate: "place_description", retrievedAt: context.retrievedAt, applicability: "applicable", retention: "bounded_excerpt" },
}];

for (let attempt = 1; attempt <= repetitions; attempt += 1) {
  for (const testCase of cases) {
    const executionId = `strands-v2-live-${testCase.id}-${attempt}`;
    const tools = new AgentToolRegistry(), evidenceRegistry = new ToolEvidenceRegistry();
    let executedToolCalls = 0;
    if (testCase.exposeReadTool) {
      tools.register({ name: "lookup_verified_place", description: "指定された場所について、評価fixture内の確認済み資料を取得します。",
        effect: "read", inputSchema: verifiedPlaceInputSchema,
        parseInput: (value: unknown) => validateAgentToolInput(verifiedPlaceInputSchema, value),
        execute: async () => {
          executedToolCalls += 1;
          return successfulAgentToolResult({ place: "京都", sourceTitle: "京都の確認済み評価資料",
            sourceExcerpt: "京都は評価fixtureで確認済みの旅行先です。", sourceUrl: "https://example.test/strands-v2/kyoto" });
        } });
      evidenceRegistry.register("lookup_verified_place", syntheticEvidence);
    }
    const ledger = new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "strands-v2-live-v2"),
      { requestedMode: "standard", effectiveMode: "standard" });
    const engine = new StrandsAgentEngine({ modelId, region, systemPrompt: agentV2SystemPrompt,
      maxTurns: limits.maxIterations, maxOutputTokens: 1_024, toolTimeoutMs: 10_000 });
    const runtime = createStrandsServerRuntime(engine), startedAt = Date.now();
    let observation: LiveObservation, error: string | undefined;
    try {
      const result = await runtime({ executionId, userRequest: testCase.userRequest,
        researchMode: { requestedMode: "standard", effectiveMode: "standard" },
        context: { featureContext: { calendarDate: "2026-09-26" } }, tools, evidenceRegistry,
        toolExecutor: new AgentToolExecutor(tools, evidenceRegistry), limits, researchLedger: ledger });
      const usage = ledger.outcome({ remainingScopes: [] }).usage;
      observedModelCalls += usage.modelCalls;
      observation = { status: result.status, deliveryBasis: result.delivery?.basis, publicReply: result.publicReply,
        toolCalls: executedToolCalls, evidenceCount: result.evidence.length,
        claimStatuses: result.claims.map(({ groundingStatus }) => groundingStatus), response: result.response,
        modelCalls: usage.modelCalls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, durationMs: Date.now() - startedAt };
    } catch (caught) {
      error = classifyStrandsV2LiveError(caught);
      // A failed invocation is not proof of zero Provider calls or zero billable tokens.
      observation = { status: "execution_error", toolCalls: executedToolCalls, evidenceCount: 0, claimStatuses: [], response: "",
        modelCalls: null, inputTokens: null, outputTokens: null, durationMs: Date.now() - startedAt };
    }
    const failures = error ? [error] : evaluateStrandsV2LiveCase(testCase, observation);
    if (observedModelCalls > maximumModelCalls) failures.push("model_call_budget_exceeded");
    results.push({ caseId: testCase.id, attempt, passed: failures.length === 0, failures, observation });
  }
}
const report: LiveReport = { schemaVersion: "strands-v2-live-eval-v2", modelId, region, repetitions, maximumModelCalls,
  observedModelCalls, unknownUsageRuns: results.filter(({ observation }) => observation.modelCalls === null).length,
  stablePassed: cases.filter(({ id }) => results.filter((result) => result.caseId === id).every(({ passed }) => passed)).length,
  cases: cases.length, results };
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(`${outputDirectory}/report.md`, renderReport(report), "utf8");
console.log(`Strands v2 Live Eval: ${report.stablePassed}/${report.cases} stable; measured modelCalls=${observedModelCalls}/${maximumModelCalls}; unknownUsageRuns=${report.unknownUsageRuns}`);
if (process.argv.includes("--require-all") && report.stablePassed !== report.cases) process.exitCode = 1;
interface LiveObservation extends StrandsV2LiveObservation {
  modelCalls: number | null; inputTokens: number | null; outputTokens: number | null; durationMs: number;
}
interface LiveResult { caseId: StrandsV2LiveCase["id"]; attempt: number; passed: boolean; failures: string[]; observation: LiveObservation }
interface LiveReport {
  schemaVersion: "strands-v2-live-eval-v2"; modelId: string; region: string; repetitions: number;
  maximumModelCalls: number; observedModelCalls: number; unknownUsageRuns: number; stablePassed: number; cases: number; results: LiveResult[];
}
function renderReport(report: LiveReport): string {
  const rows = report.results.map(({ caseId, attempt, passed, failures, observation: o }) =>
    `| ${caseId} | ${attempt} | ${passed ? "PASS" : "FAIL"} | ${o.publicReply?.kind ?? "unadmitted"} | ${o.modelCalls ?? "unknown"} | ${o.toolCalls} | ${o.inputTokens ?? "unknown"} | ${o.outputTokens ?? "unknown"} | ${o.durationMs} | ${failures.join(", ") || "-"} |`);
  return ["# Strands Agent v2 Live Evaluation", "", `- Model: ${report.modelId}`, `- Region: ${report.region}`,
    `- Stable: ${report.stablePassed}/${report.cases}`, `- Measured model calls: ${report.observedModelCalls}/${report.maximumModelCalls}`,
    `- Runs with unknown usage: ${report.unknownUsageRuns}`, "",
    "| Case | Attempt | Result | Admitted kind | Model calls | Tool calls | Input tokens | Output tokens | ms | Failures |",
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |", ...rows, ""].join("\n");
}
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1];
}
function integerArgument(name: string, fallback: number, maximum: number): number {
  const raw = argument(name); if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be 1..${maximum}`);
  return value;
}
