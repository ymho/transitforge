import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AwsBedrockConverseClient } from "../backend/agent-api/src/adapters/aws-sdk-clients";
import { BedrockConversationModel } from "../backend/agent-api/src/adapters/bedrock-conversation-model";
import { agentSystemPrompt } from "../backend/agent-api/src/usecases/agent-system-prompt";
import { runViewerAgentRuntime } from "../frontend/src/adapters/bedrock/viewer-agent-runtime";
import { askProgressFixture } from "../frontend/src/adapters/bedrock/ask-progress-scenarios.fixture";
import { railSelectionFixture } from "../modules/trip/domain/selected-rail-journey.fixture";
import { assessRailCoverage } from "../modules/trip/domain/travel-coverage";
import { createTravelCandidate } from "../modules/trip/domain/travel-candidate";
import type { AgentTrace } from "../frontend/src/usecases/agent/agent-trace";

/** Synthetic provider IO, real Domain coverage + Viewer Runtime + configured Bedrock model.
 * No Trip writes, no provider payload/CoT recording; scenario output is synthetic only. */
const output = resolve(process.argv[2] ?? "/tmp/raiquora-live-coverage");
const model = new BedrockConversationModel(new AwsBedrockConverseClient(), {
  modelId: process.env.MODEL_ID?.trim() || "amazon.nova-lite-v1:0", maxOutputTokens: 4096, systemPrompt: agentSystemPrompt,
});
const reports = [];
for (const mode of ["outside-alternative", "unknown-research"] as const) {
  const f = askProgressFixture("C-candidate"), a = railSelectionFixture(), b = railSelectionFixture();
  a.candidate.candidateId = "candidate-a"; b.candidate.candidateId = "candidate-b";
  if (mode === "outside-alternative") a.inputs[0]!.index.station_line_catalog!.lines[0]!.stations.pop();
  else a.inputs = [];
  const choices = [a, b].map((v) => ({ ...v, value: createTravelCandidate({ id: v.candidate.candidateId, journey: v.candidate.journey }),
    coverage: assessRailCoverage(v.candidate, v.inputs, v.selectedAt) }));
  let modelCalls = 0, researchCalls = 0, trace: AgentTrace | undefined;
  const before = JSON.stringify(f.trip);
  const response = await runViewerAgentRuntime(mode === "outside-alternative"
    ? "候補Aを希望していましたが、対応範囲外なら無理に採用せず、候補Bを含めて収録時刻表で移動を確認できる代案を見たいです。"
    : "未知の場所も気になります。候補Aのアクセスはまだ未確認なら、名前だけで行けると決めず追加で調べてください。", {
    ...f.base,
    getTravelCandidates: () => choices.map((v) => ({ id: v.value.id, label: v.value.id === "candidate-a" ? "候補A" : "候補B", serviceCoverage: v.coverage })),
    candidateSelection: { taskId: "coverage-task", port: {
      resolve: async (id) => { const v = choices.find((c) => c.value.id === id); return v ? {
        candidate: v.value, tripId: f.trip.id, taskId: "coverage-task", validUntil: "2026-09-12T09:00:00Z", rail: v.candidate,
        assessmentFacts: { candidateId: id, rail: { candidate: v.candidate, inputs: v.inputs } },
      } : undefined; },
      loadTimetables: async (candidate) => choices.find((c) => c.candidate.candidateId === candidate.candidateId)?.inputs ?? [],
    } },
    searchWeb: async (input) => { researchCalls++; return f.base.searchWeb!(input); },
    readWebPages: async (input) => { researchCalls++; return f.base.readWebPages!(input); },
    storeAgentTrace: async (value) => { trace = value; },
  }, async (messages, tools, modelClass) => {
    modelCalls++;
    const r = await model.converse({ messages, ...(tools ? { tools } : {}), ...(modelClass ? { modelClass } : {}) });
    return { message: r.message, stopReason: r.stopReason, metadata: r.metadata };
  });
  const proposal = typeof response !== "string" && "tripUpdateProposal" in response;
  reports.push({ mode, coverage: choices.map((v) => ({ candidateId: v.value.id, status: v.coverage.status })),
    modelCalls, researchCalls, tools: trace?.events.filter((e) => e.type === "tool_called").map((e) => e.toolName),
    tripUnchanged: JSON.stringify(f.trip) === before, proposal, response,
  });
}
await mkdir(output, { recursive: true });
await writeFile(`${output}/coverage.json`, JSON.stringify(reports, null, 2));
console.log(`Coverage Live: ${reports.length} scenarios (${output}); inspect bounded outputs for alternative/research quality.`);
