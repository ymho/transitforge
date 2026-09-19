import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AwsBedrockConverseClient } from "../backend/agent-api/src/adapters/aws-sdk-clients";
import { BedrockConversationModel } from "../backend/agent-api/src/adapters/bedrock-conversation-model";
import { agentSystemPrompt } from "../backend/agent-api/src/usecases/agent-system-prompt";
import { ConversationModelProvider } from "../backend/agent-api/src/adapters/conversation-model-provider";
import { MultiStepAgentRuntime } from "@raiquora/agent/agent-runtime";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { extractAgentDecisionSummary } from "@raiquora/agent/agent-decision-summary";
import { sourceExplanation } from "@raiquora/agent/grounded-answer";
import { structuredModelClassPolicy } from "@raiquora/agent/structured-model-class-policy";

// Synthetic, attributed sources; actual Converse/Runtime/Claim validation. No provider recordings.
const output = resolve(process.argv[2] ?? "/tmp/raiquora-live-place-grounding");
const model = new BedrockConversationModel(new AwsBedrockConverseClient(), {
  modelId: process.env.MODEL_ID?.trim() || "amazon.nova-lite-v1:0",
  decisionModelId: process.env.DECISION_MODEL_ID?.trim() || "jp.amazon.nova-2-lite-v1:0",
  maxOutputTokens: 4096, systemPrompt: agentSystemPrompt,
});
const evidence: Evidence[] = [
  ["history", "白壁の町", "白壁の町並みを歩きながら歴史資料館を巡れます。川沿いに休憩所があります。"],
  ["forest", "森の散策園", "木陰の遊歩道で森林浴を楽しめます。起伏のある散策路が続きます。"],
].map(([id, title, text]) => ({ id: `source-${id}`, category: "external", knowledgeKind: "deterministic_fact", subject: title!,
  facts: { status: "available", freshness: "fresh", sourceTitle: title!, sourceExcerpt: text!, sourceUrl: `https://example.org/${id}`, sourcePrecision: "read-page" },
  references: [{ sourceType: "external-source", sourceRef: `https://example.org/${id}`, retrievedAt: "2026-09-18T00:00:00Z", freshness: "current", summary: "合成の観光案内" }] }));
const scenarios = [
  { id: "features", prompt: "取得した白壁の町の情報から、どんな場所か特徴を教えてください。" },
  { id: "comparison", prompt: "取得した白壁の町と森の散策園は、どんな楽しみ方の違いがありますか？両方を比較してください。" },
  { id: "profile", prompt: "私の普段の好みを踏まえて、どちらがおすすめか、資料の具体的な特徴と推薦理由を分けて説明してください。" },
];
const results = [];
for (const scenario of scenarios) {
  const tools = new AgentToolRegistry();
  let calls = 0;
  const formats: string[] = [];
  const contractDiagnostics: Record<string, unknown>[] = [];
  const runtime = new MultiStepAgentRuntime({ tools, toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()),
    model: new ConversationModelProvider({ converse: async (request) => {
      calls++; const result = await model.converse(request);
      const text = result.message.content.flatMap((block) => "text" in block ? [block.text] : []).join("\n");
      formats.push(text.includes('"source-explanation"') ? (text.includes("```") ? "fenced-source-selection" : "source-selection") : "other");
      const clean = text.replace(/<(thinking|analysis)>[\s\S]*?<\/\1>/giu, "").replace(/<decision_summary>[\s\S]*?<\/decision_summary>/gu, "").trim();
      const decision = extractAgentDecisionSummary([text]);
      let embeddedSourceValid = false;
      let embeddedInference = false;
      try {
        const structured = sourceExplanation(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1), evidence, { favoriteInterests: ["歴史"] });
        embeddedSourceValid = structured !== undefined;
        embeddedInference = structured?.claims.some((claim) => claim.kind === "inference") === true;
      } catch { /* Record contract booleans only, never raw model output. */ }
      contractDiagnostics.push({ instructionPresent: JSON.stringify(request.messages).includes("資料に基づく場所の説明"),
        summaryStatus: decision.status, interpretedGoal: decision.summary?.interpretedGoal,
        reasonCodes: decision.summary?.reasonCodes, softPreferences: decision.summary?.softPreferences,
        embeddedSourceValid, embeddedInference,
        hasSections: clean.includes('"sections"'), hasKind: clean.includes('"kind"'), hasFence: clean.includes("```"),
        startsWithJson: clean.startsWith("{"), bodyLength: clean.length, modelId: result.metadata?.modelId });
      return { message: result.message, stopReason: result.stopReason, metadata: result.metadata };
    } }, `place-grounding-${scenario.id}`), modelClassPolicy: structuredModelClassPolicy,
    limits: { maxModelCalls: 3, maxIterations: 3, maxToolCalls: 2, maxExecutionMs: 90000 } });
  const result = await runtime.run({ executionId: `place-grounding-${scenario.id}`, feature: "journey_planning", userRequest: scenario.prompt,
    initialEvidence: evidence, context: { travelProfile: { favoriteInterests: ["歴史"] } } });
  const facts = result.claims.filter((c) => c.kind !== "unknown");
  const safety = facts.length > 0 && facts.every((c) => c.groundingStatus === "supported");
  const helpful = result.status === "completed" && result.response.includes("歴史資料館") && result.response.includes("https://example.org/history") &&
    (scenario.id !== "comparison" || result.response.includes("木陰") && result.response.includes("https://example.org/forest")) &&
    (scenario.id !== "profile" || result.claims.some((c) => c.kind === "inference") && result.response.includes("歴史"));
  results.push({ id: scenario.id, status: result.status, safety, helpful, modelCalls: calls,
    toolCalls: result.trace.events.filter((event) => event.type === "tool_called").length, response: result.response, formats, contractDiagnostics,
    factualClaims: facts.length, supported: facts.filter((c) => c.groundingStatus === "supported").length });
}
await mkdir(output, { recursive: true });
await writeFile(`${output}/place-grounding.json`, JSON.stringify(results, null, 2));
console.log(`Place Live safety ${results.filter((r) => r.safety).length}/3; helpful ${results.filter((r) => r.helpful).length}/3 (${output})`);
