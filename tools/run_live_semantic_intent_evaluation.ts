import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AwsBedrockConverseClient } from "../backend/agent-api/src/adapters/aws-sdk-clients";
import { BedrockConversationModel } from "../backend/agent-api/src/adapters/bedrock-conversation-model";
import { createConversationIntentInterpreter } from "../backend/agent-api/src/usecases/agent/conversation-intent-interpreter";
import type { ConversationModel, ConversationModelUsage } from "../backend/agent-api/src/ports/conversation-model";
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import { semanticIntentCorpusInputs } from "../frontend/src/usecases/agent/evaluation/semantic-intent-corpus-inputs";
import { semanticIntentCorpusExpected } from "../frontend/src/usecases/agent/evaluation/semantic-intent-corpus-expected";
import { scoreSemanticInterpretation } from "../frontend/src/usecases/agent/evaluation/semantic-intent-evaluation";

const repetitions = integerArg("--repetitions", 3, 1, 5);
const limit = integerArg("--limit", semanticIntentCorpusInputs.length, 1, semanticIntentCorpusInputs.length);
const selectedId = arg("--case");
const inputs = semanticIntentCorpusInputs.filter(({ caseId }) => !selectedId || caseId === selectedId).slice(0, limit);
if (!inputs.length) throw new Error("No matching semantic evaluation cases");
const maximumCalls = integerArg("--max-calls", 30, 1, 1_000);
const plannedCalls = inputs.length * repetitions;
if (plannedCalls > maximumCalls) throw new Error(`Planned calls ${plannedCalls} exceed --max-calls ${maximumCalls}`);
const maximumInputTokens = integerArg("--max-input-tokens", 250_000, 1, 10_000_000);
const maximumOutputTokens = integerArg("--max-output-tokens", 100_000, 1, 10_000_000);
const maximumEstimatedUsd = numberArg("--max-estimated-usd", 1, 0.01, 1_000);
const inputRate = environmentRate("DECISION_INPUT_USD_PER_MILLION");
const outputRate = environmentRate("DECISION_OUTPUT_USD_PER_MILLION");
if (inputRate === undefined || outputRate === undefined) throw new Error("Set decision model token rates before paid evaluation");

const outputDirectory = resolve(arg("--output-dir") ?? "/tmp/raiquora-semantic-intent-eval");
const modelId = process.env.DECISION_MODEL_ID?.trim() || "jp.amazon.nova-2-lite-v1:0";
const rawModel = new BedrockConversationModel(new AwsBedrockConverseClient(), { modelId, decisionModelId: modelId, systemPrompt: "", timeoutMs: 80_000 });
const usage: Required<Pick<ConversationModelUsage, "inputTokens" | "outputTokens">> & { calls: number; latencyMs: number } = { inputTokens: 0, outputTokens: 0, calls: 0, latencyMs: 0 };
const model: ConversationModel = { converse: async (request) => {
  if (usage.calls >= maximumCalls) throw new Error("Model call budget exhausted");
  const response = await rawModel.converse(request); usage.calls += 1; usage.latencyMs += response.metadata.latencyMs;
  usage.inputTokens += response.metadata.usage?.inputTokens ?? 0; usage.outputTokens += response.metadata.usage?.outputTokens ?? 0;
  enforceBudget(); return response;
} };
const interpret = createConversationIntentInterpreter(model);
const expected = new Map(semanticIntentCorpusExpected.map((item) => [item.caseId, item]));
const results: Array<{ attempt: number; caseId: string; category: string; passed: boolean; failures: string[]; outcome?: string; error?: string }> = [];

for (let attempt = 1; attempt <= repetitions; attempt += 1) {
  for (const input of inputs) {
    const gold = expected.get(input.caseId); if (!gold) throw new Error(`Missing gold ${input.caseId}`);
    try {
      const actual = await interpret({ userRequest: input.utterance, calendarDate: input.calendarDate, overlay: emptyConversationIntentOverlay(),
        turnId: `00000000-0000-4000-8000-${String(results.length + 1).padStart(12, "0")}` });
      const score = scoreSemanticInterpretation(gold, actual);
      results.push({ attempt, caseId: input.caseId, category: input.category, passed: score.passed, failures: score.failures, outcome: actual.outcome });
    } catch (error) {
      results.push({ attempt, caseId: input.caseId, category: input.category, passed: false, failures: ["execution-failure"],
        error: error instanceof Error ? error.name : "unknown" });
    }
  }
}

const stable = inputs.map(({ caseId }) => ({ caseId, passed: results.filter((item) => item.caseId === caseId).every(({ passed }) => passed) }));
const report = { schemaVersion: "semantic-intent-live-eval-v1", modelId, repetitions, plannedCalls, executedCalls: usage.calls,
  inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs: usage.latencyMs, estimatedCostUsd: estimatedCost(),
  cases: inputs.length, stablePassed: stable.filter(({ passed }) => passed).length, results };
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(`${outputDirectory}/manifest.json`, `${JSON.stringify({ schemaVersion: "semantic-intent-live-eval-manifest-v1", modelId,
  corpus: "public-development-v1", expectedBoundary: "scorer-only", repetitions, caseIds: inputs.map(({ caseId }) => caseId),
  budgets: { maximumCalls, maximumInputTokens, maximumOutputTokens, maximumEstimatedUsd }, rates: { inputRate, outputRate }, executedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
console.log(`Semantic intent live eval: ${report.stablePassed}/${report.cases} stable; calls=${usage.calls}; estimated=$${report.estimatedCostUsd.toFixed(4)}`);
if (process.argv.includes("--require-all") && report.stablePassed !== report.cases) process.exitCode = 1;

function enforceBudget(): void {
  if (usage.inputTokens > maximumInputTokens || usage.outputTokens > maximumOutputTokens || estimatedCost() > maximumEstimatedUsd) throw new Error("Paid evaluation budget exhausted");
}
function estimatedCost(): number { return usage.inputTokens * inputRate! / 1_000_000 + usage.outputTokens * outputRate! / 1_000_000; }
function arg(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function integerArg(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = arg(name); if (raw === undefined) return fallback; const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`); return value;
}
function numberArg(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = arg(name); if (raw === undefined) return fallback; const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`); return value;
}
function environmentRate(name: string): number | undefined {
  const raw = process.env[name]; if (!raw) return undefined; const value = Number(raw); return Number.isFinite(value) && value >= 0 ? value : undefined;
}
