import { expect, it } from "vitest";
import type { Message, ModelStreamEvent } from "@strands-agents/sdk";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { externalTravelEvidence } from "@raiquora/agent/external-travel-evidence";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import type { ReplyReference } from "@raiquora/agent/agent-v2-reply";
import { productionServerTools } from "./production-server-tools.js";
import { registerServerTools } from "../usecases/agent/server-tools.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { StrandsScriptedModel } from "../adapters/strands-scripted-model.fixture.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { ResearchExecutionLedger, researchBudgetForRuntimeLimits } from "@raiquora/agent/research-execution";

// No Bedrock or real Provider calls. Copy the actual Tool reference without inventing IDs.
it.each(["retained_page", "weather"] as const)("publishes an exact Tool reference with production evidence budgeting: %s", async choice => {
  const now = "2026-10-11T06:00:00Z";
  const urls = Array.from({ length: 12 }, (_, index) => `https://example.test/fixture-${index}`);
  let mediaCalls = 0;
  const bindings = productionServerTools({
    discovery: async () => ({ body: { discovery: { batch: {
      hits: urls.map((sourceRef, index) => ({ hitId: `hit-${index}`, sourceRef, retrievalChannel: "web", text: "城崎温泉", originalRank: index + 1 })),
      coverage: { completedQueries: 6 }, incompleteReasons: [],
    } } } }),
    external: {
      readWebPages: async ({ urls }) => ({ webPages: { status: "available", freshness: "fresh",
        data: { pages: urls.map(url => ({ url, title: "城崎温泉", text: "城崎温泉の検証用資料です。" })) },
        evidence: urls.map((sourceUrl, index) => ({ id: `page-${index}`, provider: "fixture-reader", sourceUrl, retrievedAt: now })),
      } }),
      searchPlaceMedia: async () => { mediaCalls++; return { result: { status: "available", freshness: "fresh",
        data: { places: urls.slice(0, 4).map((officialWebsiteUrl, index) => ({ providerPlaceId: `place-${index}`,
          name: "城崎温泉", summary: "検証用の紹介", sourceUrl: "https://www.mapbox.com/", officialWebsiteUrl })) },
        evidence: Array.from({ length: 4 }, (_, index) => ({ id: `mapbox-observation-${index}`, provider: "mapbox", sourceUrl: "https://www.mapbox.com/", retrievedAt: now })),
      } }; },
    },
    accommodation: async () => ({ body: {} }), journey: async () => ({ body: {} }),
  });
  const tools = new AgentToolRegistry(), registry = new ToolEvidenceRegistry();
  registerServerTools(tools, registry, bindings);
  tools.register({ name: "search_weather_forecast", description: "検証用の天気情報", effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, parseInput: () => validAgentToolInput({}),
    execute: async () => successfulAgentToolResult({ forecast: { status: "available", freshness: "fresh",
      data: { locationName: "城崎温泉" }, evidence: [{ id: "fixture-weather", provider: "fixture-weather",
        sourceUrl: "https://example.test/weather", retrievedAt: now }],
    } }),
  });
  registry.register("search_weather_forecast", externalTravelEvidence);
  const steps: { name: string; input: unknown }[] = [
    { name: "explore_destination", input: { destination: "城崎温泉" } },
    { name: "search_weather_forecast", input: {} },
    { name: "strands_structured_output", input: {} }, { name: "strands_structured_output", input: {} },
  ];
  class CopyingModel extends StrandsScriptedModel {
    override async *stream(messages: Message[]): AsyncGenerator<ModelStreamEvent> {
      if (this.calls === 2) {
        const results = (JSON.parse(JSON.stringify(messages)) as { content: { toolResult?: {
          content: { json: { replyReferences: { reference: ReplyReference }[] } }[];
        } }[] }[]).flatMap(message => message.content).flatMap(block => block.toolResult ? [block.toolResult.content[0]!.json] : []);
        const offered = choice === "retained_page" ? results[0]! : results[1]!;
        const field = choice === "retained_page" ? "sourceExcerpt" : "resultKind";
        const reference = offered.replyReferences.find(item => item.reference.field === field)!.reference;
        for (const step of steps.slice(2)) step.input = { reply: { kind: "answer", references: [reference], commentary: "取得した資料を確認しました。" } };
      }
      yield* super.stream(messages);
    }
  }
  const validations: Record<string, unknown>[] = [], model = new CopyingModel(steps);
  const engine = new StrandsAgentEngine({ modelId: "synthetic", region: "test", systemPrompt: "Copy the offered reference", maxTurns: 4,
    log: (event, fields) => { if (event === "agent_reply_validation") validations.push(fields); },
  }, { model });
  const limits = { maxIterations: 4, maxModelCalls: 4, maxToolCalls: 2, maxExecutionMs: 10_000, maxEvidence: 20 };
  const result = await createStrandsServerRuntime(engine)({ executionId: "synthetic-production-budget", userRequest: "明日日帰りで城崎温泉にいきたい",
    tools, evidenceRegistry: registry, toolExecutor: new AgentToolExecutor(tools, registry), limits,
    researchMode: { requestedMode: "standard", effectiveMode: "standard" },
    researchLedger: new ResearchExecutionLedger(researchBudgetForRuntimeLimits(limits, "synthetic-budget"),
      { requestedMode: "standard", effectiveMode: "standard" }) });
  expect(mediaCalls).toBe(1);
  expect(validations.every(value => value.evidenceCount === 25 && value.retainedEvidenceCount === 20 && value.omittedEvidenceCount === 5)).toBe(true);
  expect(result.status).toBe("completed");
  expect(result.publicReply?.kind).toBe("answer");
  expect(result.evidence).toHaveLength(1);
  expect(result.claims.every(claim => claim.groundingStatus === "supported")).toBe(true);
  expect(model.calls).toBe(3);
  expect(validations).toHaveLength(1);
  expect(validations[0]).toMatchObject({ outcome: "completed", unknownReferenceCount: 0, omittedReferenceCount: 0 });
});
