import { describe, expect, it } from "vitest";
import { Agent, AfterToolCallEvent } from "@strands-agents/sdk";
import { outputSyntaxDiagnostic } from "../adapters/strands-output-syntax.fixture.js";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";
import { conditionDelta } from "@raiquora/agent/conversation-condition";
import { reduceConversationIntent } from "@raiquora/agent/conversation-intent-reducer";
import { compileEffectiveIntent } from "@raiquora/agent/effective-intent";
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import type { PartyScopeCatalog } from "@raiquora/trip/party-cohorts";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

// Synthetic fixture only. Hooks observe SDK validation; they never rewrite inputs,
// retry a Tool, publish a fallback or log prose, IDs, exception messages or reasoning.

describe.skipIf(process.env.AGENT_V2_LIVE !== "true")("dialogue output with real Nova 2 Lite", () => {
  it("finishes a nonpersistent participation what-if through SDK structured output", async () => {
    const catalog: PartyScopeCatalog = { tripId: "known-trip", tripRevision: 2,
      days: ["day-a", "day-b", "day-c"].map((id, index) => ({ id, label: `${index + 1}日目` })),
      segments: [{ id: "outbound", label: "往路" }, { id: "return", label: "帰路" }] };
    let overlay = emptyConversationIntentOverlay();
    overlay = reduceConversationIntent(overlay, conditionDelta({ target: "party_size", party: { kind: "count", people: 3 }, quote: "全体で3人" }, "prior-count", overlay)).overlay;
    overlay = reduceConversationIntent(overlay, conditionDelta({ target: "party_details", quote: "以前の合成条件", cohorts: [
      { count: 1, membership: "baseline", schoolStage: "university", ageDecade: "teens", scope: { kind: "whole_trip" } },
      { count: 1, membership: "baseline", schoolStage: "university", ageDecade: "twenties", scope: { kind: "logical_days", tripId: catalog.tripId, tripRevision: 2, dayIds: ["day-a", "day-b"] } },
    ] }, "prior-details", overlay)).overlay;
    const before = structuredClone(overlay);
    const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
    const limits = { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 1, maxExecutionMs: 60000, maxEvidence: 4 };
    let writerCallbacks = 0;
    const engine = new StrandsAgentEngine({ modelId: process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0", region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxOutputTokens: 1536, maxInvocationOutputTokens: 1536 }, {
      createAgent: config => { const agent = new Agent(config); agent.addHook(AfterToolCallEvent, event => {
        if (event.toolUse.name === "strands_structured_output") console.log(JSON.stringify({ event: "output_syntax", sdkStatus: event.result.status, ...outputSyntaxDiagnostic(event.toolUse.input) }));
      }); return agent; },
    });
    const result = await createStrandsServerRuntime(engine)({ executionId: "dialogue-output", userRequest: "もし20代の大学生も全行程に参加できるならどうですか。今の条件は変えずに考えてください。",
      researchMode: { requestedMode: "standard", effectiveMode: "standard" }, context: { effectiveIntent: compileEffectiveIntent({ overlay }) },
      tools, evidenceRegistry: evidence, toolExecutor: new AgentToolExecutor(tools, evidence), limits,
      researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "dialogue-output"), { requestedMode: "standard", effectiveMode: "standard" }),
      reportExecution: async diagnostic => { console.log(JSON.stringify({ event: "execution", ...diagnostic })); },
      conditionController: { scopeCatalog: catalog, apply: async () => { writerCallbacks++; throw new Error("what-if must not write"); } },
    });
    expect(writerCallbacks).toBe(0);
    expect(overlay).toEqual(before);
    expect(result.status).toBe("completed");
    expect(result.response.trim().length).toBeGreaterThan(0);
  }, 90000);
});
