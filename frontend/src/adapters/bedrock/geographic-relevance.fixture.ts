import { askProgressFixture } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime, type BedrockAgentConverse } from "./viewer-agent-runtime";
import type { AgentTrace } from "../../usecases/agent/agent-trace";
import { evaluateRecommendationOutcome } from "../../usecases/agent/evaluation/recommendation-outcome";

/** Authored wrong-region fixture, not live provider data. Only Bedrock is live. */
export async function runGeographicRelevance(live: BedrockAgentConverse) {
  const wrong = { name: "評価用日向海岸", area: "宮崎県日向市", url: "https://example.com/miyazaki-hyuga", id: "fixture.hyuga" };
  const good = { name: "評価用桂川緑地", area: "京都府向日市周辺", url: "https://example.com/kyoto-nature", id: "fixture.kyoto" };
  const source = (p: typeof wrong) => ({ id: p.id, kind: "place", provider: "fixture", sourceId: p.id,
    sourceUrl: p.url, retrievedAt: "2026-09-12T08:00:00Z", confidence: "observed" });
  const page = (p: typeof wrong) => ({ url: p.url, title: p.name,
    text: `${p.name}は${p.area}の散策施設です。${p === wrong ? "京都府向日市ではなく、近場という条件には合いません。" : "散策を楽しめます。"}`,
    contentType: "html", truncated: false, untrustedExternalContent: true });
  let firstSearch = true;
  let calls = 0;
  let trace: AgentTrace | undefined;
  const response = await runViewerAgentRuntime("向日町駅から近場で、のんびり海や自然を感じる旅がしたい", {
    ...askProgressFixture("B-known-region").base,
    getCurrentTrip: undefined,
    storeAgentTrace: async value => { trace = value; },
    searchWeb: async ({ query }) => {
      // First discovery is contaminated. Subsequent geographic retrieval can recover;
      // no grading requires a particular query or a second search.
      const p = firstSearch ? wrong : good;
      firstSearch = false;
      return { webSearch: { status: "available", freshness: "fresh", evidence: [source(p)],
        data: { query, results: [{ id: p.id, title: `${p.name} (${p.area})`, url: p.url, description: page(p).text }] } } };
    },
    readWebPages: async ({ urls }) => {
      const selected = [wrong, good].filter(p => urls.includes(p.url));
      return { webPages: { status: "available", freshness: "fresh", evidence: selected.map(source), data: { pages: selected.map(page) } } };
    },
    searchPlaceMedia: async ({ query }) => {
      const p = query.includes(good.name) || /京都|桂川/u.test(query) ? good : wrong;
      return { result: { status: "available", freshness: "fresh", evidence: [source(p)], data: { places: [{
        providerPlaceId: p.id, name: p.name, address: p.area, sourceUrl: p.url, officialWebsiteUrl: p.url,
        latitude: p === wrong ? 32.42 : 34.95, longitude: p === wrong ? 131.62 : 135.73, openingHoursStatus: "unknown",
        sources: [{ provider: "fixture", label: "Fixture", url: p.url, role: "identity" }],
      }] } } };
    },
  }, async (...args) => { calls++; return live(...args); });
  const finalAnswer = typeof response === "string" ? response : response.text;
  const candidates = typeof response !== "string" && "external" in response
    ? response.external?.places?.data?.places ?? [] : [];
  const proposedItems = typeof response !== "string" && "tripUpdateProposal" in response
    ? response.tripUpdateProposal?.patches.flatMap(p => p.type === "add" || p.type === "replace"
      ? [{ name: JSON.stringify(p.item) }] : []) ?? [] : [];
  const completed = trace?.events.some(e => e.type === "task_completed" && ["completed", "follow_up"].includes(e.status)) ?? false;
  return { ...evaluateRecommendationOutcome({ forbiddenNames: [wrong.name, "日向海岸", "宮崎県", "日向市"], recoveredNames: [good.name, "桂川緑地"] },
    { finalAnswer, candidates: [...candidates, ...proposedItems], completed }), finalAnswer, candidates, proposedItems, modelCalls: calls,
    tools: trace?.events.flatMap(e => e.type === "tool_called" ? [e.toolName] : []) ?? [], trace };
}
