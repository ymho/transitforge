import { expect, it, vi } from "vitest";
import { mergeEvidenceObservations, validateEvidenceReferences } from "@raiquora/agent/evidence-model";
import { BraveWebSearchProvider } from "../adapters/brave-web-search-provider.js";
import { WebTravelKnowledgeRetriever } from "../adapters/web-travel-knowledge-retriever.js";
import { createTravelDiscoveryOperation } from "../usecases/discover-travel-candidates.js";
import { productionServerTools } from "./production-server-tools.js";

const context = { executionId: "turn-a", toolCallId: "call-a", toolName: "explore_destination",
  queryFingerprint: "same-query", retrievedAt: "2026-09-29T00:00:00Z" };

function fixture() {
  let now = new Date(context.retrievedAt);
  const provider = new BraveWebSearchProvider({ fetch: async url => {
    const query = new URL(url).searchParams.get("q")!;
    return Response.json({ web: { results: [1, 2].map(rank => ({
      url: `https://example.test/${encodeURIComponent(query)}/${rank}`, title: "合成神社", description: `合成資料${rank}`,
    })) } });
  } }, { load: async () => ({ apiKey: "synthetic" }) }, () => now);
  const discovery = createTravelDiscoveryOperation({ retrievers: [new WebTravelKnowledgeRetriever(provider)] });
  const binding = productionServerTools({ discovery, accommodation: vi.fn(), journey: vi.fn(), external: {
    readWebPages: async ({ urls }) => ({ webPages: { status: "available", freshness: "fresh",
      data: { pages: urls.map((url, index) => ({ url, title: "合成神社", text: `合成神社の紹介${index}` })) },
      evidence: urls.map((sourceUrl, index) => ({ id: `page-${index}`, provider: "safe-reader", sourceUrl,
        retrievedAt: now.toISOString() })) } }),
    searchPlaceMedia: async () => ({ result: { status: "available", freshness: "fresh", data: { places: [] }, evidence: [] } }),
  } }).find(tool => tool.descriptor.name === "explore_destination")!;
  return { binding, advance: () => { now = new Date(now.getTime() + 1000); } };
}

it("keeps facet-local Brave ranks distinct through discovery and page/place projections", async () => {
  const { binding } = fixture();
  const response = await binding.operation({ destination: "合成神社", includeNearby: true }, { requestId: "turn-a" });
  const hits = response.body.discovery.batch.hits;
  expect(hits.length).toBeGreaterThan(2);
  expect(new Set(hits.map((hit: { hitId: string }) => hit.hitId)).size).toBe(hits.length);
  const evidence = binding.evidence(response.body, context);
  expect(validateEvidenceReferences(evidence).errors).toEqual([]);
  expect(mergeEvidenceObservations([], evidence).collisions).toEqual([]);
  expect(evidence.filter(item => item.facts.sourcePrecision === "read-page")).toHaveLength(4);
  expect(evidence.every(item => item.id.length <= 160)).toBe(true);
});

it("preserves repeated searches and prior-turn observations without aliasing acquisition time", async () => {
  const { binding, advance } = fixture();
  const input = { destination: "合成神社", includeNearby: true };
  const first = await binding.operation(input, { requestId: "turn-a" });
  const a = binding.evidence(first.body, context);
  advance();
  const second = await binding.operation(input, { requestId: "turn-a" });
  const b = binding.evidence(second.body, { ...context, toolCallId: "call-b" });
  const c = binding.evidence(second.body, { ...context, executionId: "turn-b" });
  const merged = mergeEvidenceObservations(a, [...b, ...c]);
  expect(merged.collisions).toEqual([]);
  expect(merged.conflictingObservationIds).toEqual([]);
  expect(merged.evidence).toHaveLength(a.length + b.length + c.length);
  expect(mergeEvidenceObservations(a, a).evidence).toEqual(a);
});
