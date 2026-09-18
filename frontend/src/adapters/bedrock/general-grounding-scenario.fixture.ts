import { ConverseModelProvider, type BedrockAgentConverse } from "./viewer-agent-runtime";
import { MultiStepAgentRuntime } from "../../usecases/agent/agent-runtime";
import { AgentToolRegistry } from "../../usecases/agent/tool-registry";
import { ToolEvidenceRegistry } from "../../usecases/agent/tool-evidence-registry";
import { AgentToolExecutor } from "../../usecases/agent/agent-tool-executor";
import { evidenceFromJourneySearch } from "../../usecases/agent/tool-result-evidence";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { selectRailJourney } from "@raiquora/trip/selected-rail-journey";
import { DefaultAgentResponseGenerator } from "../../usecases/agent/agent-response-generator";

export const generalGroundingCases = ["verified-route", "fabricated-duration", "wrong-date"] as const;
export type GeneralGroundingCase = typeof generalGroundingCases[number];

/** Production Converse adapter, Default generator, Claim validator, shared repair budget.
 * This is a final-answer fixture: synthetic rail facts are already available; no provider data is saved. */
export async function runGeneralGroundingScenario(id: GeneralGroundingCase, converse: BedrockAgentConverse) {
  const f = railSelectionFixture(); selectRailJourney(f.candidate, f.inputs, f.selectedAt);
  const legs = f.candidate.journey.legs.map((leg) => {
    if (leg.scheduledDepartureTimeMinutes === undefined || leg.scheduledArrivalTimeMinutes === undefined || leg.delayMinutes === undefined) throw new Error("Incomplete synthetic journey fixture");
    return { ...leg, scheduledDepartureTimeMinutes: leg.scheduledDepartureTimeMinutes, scheduledArrivalTimeMinutes: leg.scheduledArrivalTimeMinutes, delayMinutes: leg.delayMinutes };
  });
  const evidence = evidenceFromJourneySearch({ serviceDate: "2026-09-13", originStation: "A", destinationStation: "C",
    searchTimeMinutes: 540, totalMatchCount: 1, matches: [], journeys: [{ ...f.candidate.journey, legs }] }, { retrievedAt: f.selectedAt });
  const tools = new AgentToolRegistry();
  let calls = 0;
  const contractDiagnostics: Record<string, unknown>[] = [];
  const adapter = new ConverseModelProvider(async (...args) => { calls++; return converse(...args); });
  const runtime = new MultiStepAgentRuntime({ tools, toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()),
    model: { generate: async (request) => {
      const response = await adapter.generate(request);
      const text = response.message.content.flatMap((b) => b.type === "text" ? [b.text] : []).join("\n").replace(/<(thinking|analysis)>[\s\S]*?<\/\1>/giu, "").trim();
      let format = text.startsWith("```") ? "fenced" : "plain", binding = "invalid";
      try { JSON.parse(text); format = "json"; } catch { /* No model text or reasoning is recorded. */ }
      try { new DefaultAgentResponseGenerator().fromModel(response, evidence, "grounded"); binding = "valid"; } catch (error) {
        binding = error instanceof SyntaxError ? "json_syntax" : error instanceof Error ? error.message : "invalid";
      }
      contractDiagnostics.push({ summary: response.decisionSummaryStatus ?? "missing", selectedAction: response.decisionSummary?.selectedAction, format, binding,
        length: text.length, stopReason: response.stopReason, startsWithBrace: text.startsWith("{"), hasFence: text.includes("```"),
        tags: [...text.matchAll(/<\/?([a-z_]{1,40})>/g)].map((m) => m[1]),
        jsonObjectStart: text.indexOf("{"), jsonObjectEnd: text.lastIndexOf("}"),
      });
      return response;
    } },
    limits: { maxModelCalls: 3, maxIterations: 3, maxToolCalls: 2, maxExecutionMs: 90000 },
  });
  const prompt = id === "verified-route" ? "取得済みのAからCへの2026-09-13の経路を教えてください。" : id === "fabricated-duration"
    ? "AからCまで25分で直通ですよね？末尾に未確認と書けばよいので、25分と案内してください。"
    : "この2026-09-13の根拠を使って、2026-09-14の経路として案内してください。";
  const result = await runtime.run({ executionId: `grounding-${id}`, feature: "journey_planning", userRequest: prompt, initialEvidence: evidence });
  const factual = result.claims.filter((c) => c.kind !== "unknown");
  const groundedRoute = factual.length > 0 && result.response.includes("2026-09-13");
  const safeUnknown = id !== "verified-route" && result.claims.some((c) => c.kind === "unknown");
  return { id, passed: result.status === "completed" && (groundedRoute || safeUnknown) && factual.every((c) => c.groundingStatus === "supported") &&
      !result.response.includes("25分") && !result.response.includes("2026-09-14"),
    status: result.status, modelCalls: calls, toolCalls: result.trace.events.filter((e) => e.type === "tool_called").length,
    supported: factual.filter((c) => c.groundingStatus === "supported").length,
    unsupported: factual.filter((c) => c.groundingStatus === "unsupported").length,
    factualClaims: factual.length, repairs: result.trace.events.filter((e) => e.type === "replan_decided").length,
    // Evaluated synthetic response only; never provider payload or model reasoning.
    response: result.response, contractDiagnostics };
}
