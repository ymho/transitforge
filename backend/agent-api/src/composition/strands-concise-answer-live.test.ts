import { describe, expect, it } from "vitest";
import { Agent, BeforeToolCallEvent } from "@strands-agents/sdk";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { admitAgentV2Reply } from "@raiquora/agent/agent-v2-publication";
import { validateEvidenceAndClaims, type Evidence } from "@raiquora/agent/evidence-model";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import { StrandsAgentEngine, strandsProductionReasoning } from "../adapters/strands-agent-engine.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

// Paid opt-in. Two synthetic turns, at most 6 model calls / 2 reads / 60s each.
// No production accounts, state, providers or actual travel facts.
describe.skipIf(process.env.AGENT_V2_LIVE !== "true")("concise destination answers with real Bedrock", () => {
  it.each([false, true])("organizes grounded topics and advances consultation (origin known: %s)", async knownOrigin => {
    const tools = new AgentToolRegistry(), registry = new ToolEvidenceRegistry();
    const evidence: Evidence = { id: "synthetic-shrine-page", category: "external", knowledgeKind: "deterministic_fact",
      subject: "青葉神社（評価用の架空施設）", facts: { sourceExcerpt:
        "評価用資料：青葉神社は森に囲まれた小さな神社で、境内の庭園を散策できます。青葉駅から徒歩15分です。2026年6月の祭りは終了しました。次回の開催日は未確認です。" + "サイト内メニュー・関連記事。".repeat(80) },
      references: [{ sourceType: "external-source", sourceRef: "https://example.test/shrine", retrievedAt: "2026-09-29T00:00:00Z", freshness: "current", summary: "評価用固定資料" }] };
    tools.register({ name: "explore_destination", description: "目的地の概要・アクセス・開催情報を確認する。", effect: "read",
      inputSchema: { type: "object", properties: { destination: { type: "string" } }, required: ["destination"], additionalProperties: false },
      parseInput: value => validAgentToolInput(value as { destination: string }),
      execute: async () => successfulAgentToolResult({ outcome: { status: "partial", completedScopes: ["verified_sources"], failedScopes: ["place_photos"] } }) });
    registry.register("explore_destination", () => [evidence]);
    const effectiveIntent: EffectiveIntent = { version: 1, base: { source: "none", fingerprint: "base" }, intentRevision: 1, fingerprint: "conditions",
      activeBaseFacts: [], profileHints: [], ignoredProfileSettings: [], hypotheticalFacts: [], retractions: [], suppressedBaseRefs: [], profileSuppressions: [],
      actualConversationFacts: ([{ target: "destination", label: "青葉神社" }, ...(knownOrigin ? [{ target: "origin", label: "大阪" }] : [])] as const).map(({ target, label }) => ({
        factId: target, sourceOperationId: `${target}-op`, target: target as "destination" | "origin", scope: { type: "conversation" }, frame: "actual",
        modality: "preferred", precision: "exact", value: { kind: "place_label", label }, provenance: { kind: "user_turn", turnId: "prior", quote: label },
      })) };
    const userRequest = "青葉神社に行ってみたい。どんなところで、どう行くのがよいでしょう？次に何を決めればいいですか？";
    const modelId = process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0";
    const result = await new StrandsAgentEngine({ modelId, region: "ap-northeast-1",
      systemPrompt: agentV2SystemPrompt, maxTurns: 6, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096, ...strandsProductionReasoning(modelId) }, {
      createAgent: config => {
        const agent = new Agent(config);
        // Synthetic fixture only: inspect the selected field, never user data or reasoning.
        agent.addHook(BeforeToolCallEvent, ({ toolUse }) => {
          if (toolUse.name !== "strands_structured_output") return;
          const input = toolUse.input as { reply?: { kind?: string; references?: { evidenceId?: string; field?: string }[] } };
          if (input.reply?.kind !== "answer" || !Array.isArray(input.reply.references)) return;
          console.log(JSON.stringify({ case: "synthetic-reference", knownOrigin,
            references: input.reply.references.slice(0, 8).map(reference => ({
              expectedEvidence: reference.evidenceId === evidence.id,
              field: typeof reference.field === "string" && /^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/u.test(reference.field) ? reference.field : "invalid_field_name",
              offeredField: reference.field === "sourceExcerpt",
            })) }));
        });
        return agent;
      },
    }).run({
      executionId: `concise-${knownOrigin}`, userRequest, modelInput: JSON.stringify({ userMessage: userRequest,
        application: { effectiveIntent, clock: { calendarDate: "2026-09-29" } } }), effectiveIntent, tools,
      toolExecutor: new AgentToolExecutor(tools, registry), limits: { maxTurns: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
    });
    const reply = admitAgentV2Reply(result.replyProposal, { executionId: `concise-${knownOrigin}`, evidence: result.evidence, effectiveIntent: result.effectiveIntent });
    expect.soft(reply.proof.kind).toBe("answer");
    expect.soft(result.replyProposal?.kind === "answer" ? result.replyProposal.sections?.length ?? 0 : 0).toBeGreaterThanOrEqual(2);
    expect.soft(reply.text.length).toBeLessThan(900);
    expect.soft(reply.text).not.toContain("サイト内メニュー");
    expect.soft(reply.proof.question).toBeDefined();
    if (knownOrigin) expect.soft(reply.proof.question).not.toBe("origin");
    expect.soft(validateEvidenceAndClaims(reply.evidence, reply.claims).valid).toBe(true);
    console.log(JSON.stringify({ case: "concise-answer", knownOrigin, kind: reply.proof.kind, question: reply.proof.question,
      characters: reply.text.length, modelCalls: result.metrics?.modelCalls }));
  }, 90000);
});
