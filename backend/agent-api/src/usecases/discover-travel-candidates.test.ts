import { expect, it, vi } from "vitest";
import { discoverTravelCandidates } from "./discover-travel-candidates.js";
import type { CandidateReranker, DiscoveryBatch, DiscoveryHit, DiscoveryQuery, TravelKnowledgeRetriever } from "@raiquora/agent/travel-discovery";
import { ResearchExecutionLedger } from "@raiquora/agent/research-execution";

it("searches multiple typed facets, fuses duplicate source chunks, and keeps rerank relevance separate", async () => {
  const calls: string[] = [];
  const retriever: TravelKnowledgeRetriever = { channel: "web", retrieve: vi.fn(async (query: string, request: DiscoveryQuery): Promise<DiscoveryBatch> => {
    calls.push(query); return { hits: [{ hitId: `hit:${query}`, sourceRef: "https://example.test/shared", sourceVersion: "v1", text: query,
      retrievedAt: "2026-09-23T00:00:00Z", metadata: {}, retention: "bounded_excerpt", retrievalChannel: "web", originalRank: 1 }],
      coverage: { attemptedFacetKinds: request.facets.map((item) => item.kind), channels: ["web"], requestedQueries: 1, completedQueries: 1, omittedHits: 0 }, incompleteReasons: [] };
  }) };
  const reranker: CandidateReranker = { rerank: vi.fn(async (_query: string, hits: readonly DiscoveryHit[]) => ({ hits: [...hits], trace: { provider: "fixture", modelRef: "fixture",
    before: hits.map((hit) => hit.hitId), after: hits.map((hit) => hit.hitId) } })) };
  const result = await discoverTravelCandidates({ retrievers: [retriever], reranker }, { requestRef: "request", facets: [
    { kind: "area", value: "西日本" }, { kind: "season", value: "紅葉" }, { kind: "activity", value: "温泉" }, { kind: "travel_style", value: "静か" },
  ], explicitFilters: [], unresolvedFilters: [], scopeRef: "trip:1", budgetRef: "standard" },
  { maximumQueries: 6, maximumHitsPerQuery: 3, maximumOutputHits: 10, maximumTextBytes: 10_000, maximumParallelReads: 3 });
  expect(calls).toEqual(["西日本", "西日本 紅葉", "西日本 温泉", "西日本 静か"]);
  expect(result.batch.hits).toHaveLength(1); expect(result.rerank).toMatchObject({ provider: "fixture" });
  expect(result.batch.hits[0]?.metadata).not.toHaveProperty("feasibility");
});

it("keeps successful channels when another retrieval fails and enforces a UTF-8 byte budget", async () => {
  const request: DiscoveryQuery = { requestRef: "request", facets: [{ kind: "area", value: "京都" }], explicitFilters: [],
    unresolvedFilters: [], scopeRef: "trip:1", budgetRef: "standard" };
  const good: TravelKnowledgeRetriever = { channel: "web", retrieve: async (): Promise<DiscoveryBatch> => ({
    hits: [{ hitId: "web:1", sourceRef: "https://example.test/kyoto", text: "京都候補", retrievedAt: "2026-09-23T00:00:00Z",
      metadata: {}, retention: "bounded_excerpt", retrievalChannel: "web", originalRank: 1 }],
    coverage: { attemptedFacetKinds: ["area"], channels: ["web"], requestedQueries: 1, completedQueries: 1, omittedHits: 0 }, incompleteReasons: [],
  }) };
  const failed: TravelKnowledgeRetriever = { channel: "knowledge_base", retrieve: async () => { throw new Error("unavailable"); } };
  const result = await discoverTravelCandidates({ retrievers: [good, failed] }, request,
    { maximumQueries: 2, maximumHitsPerQuery: 3, maximumOutputHits: 10, maximumTextBytes: 6, maximumParallelReads: 2 });
  expect(result.batch.hits[0]?.text).toBe("京都");
  expect(result.batch.coverage.completedQueries).toBe(2);
  expect(result.batch.incompleteReasons).toContain("retrieval_failed:knowledge_base");
  expect(result.batch.incompleteReasons).toContain("text_budget_exhausted");
});

it("uses multiple generic angles for a place-only request and bounds concurrent reads", async () => {
  const calls: string[] = [];
  let active = 0, maximumActive = 0;
  const retriever: TravelKnowledgeRetriever = { channel: "web", retrieve: async (text, request): Promise<DiscoveryBatch> => {
    calls.push(text); active += 1; maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1;
    return { hits: [], coverage: { attemptedFacetKinds: request.facets.map((facet) => facet.kind), channels: ["web"],
      requestedQueries: 1, completedQueries: 1, omittedHits: 0 }, incompleteReasons: [] };
  } };
  await discoverTravelCandidates({ retrievers: [retriever] }, { requestRef: "request", facets: [{ kind: "place", value: "松江" }],
    explicitFilters: [], unresolvedFilters: [], scopeRef: "trip:1", budgetRef: "standard" },
  { maximumQueries: 3, maximumHitsPerQuery: 3, maximumOutputHits: 10, maximumTextBytes: 100, maximumParallelReads: 1 });
  expect(calls).toEqual(["松江", "松江 体験 季節", "松江 アクセス 滞在"]);
  expect(maximumActive).toBe(1);
});

it("returns typed covered and remaining scopes without starting reads beyond the reserved provider budget", async () => {
  const retrieve = vi.fn(async (_text, request: DiscoveryQuery): Promise<DiscoveryBatch> => ({ hits: [], coverage: {
    attemptedFacetKinds: request.facets.map(({ kind }) => kind), channels: ["web"], requestedQueries: 1, completedQueries: 1, omittedHits: 0 }, incompleteReasons: [] }));
  const retriever: TravelKnowledgeRetriever = { channel: "web", retrieve };
  const ledger = new ResearchExecutionLedger({ policyVersion: "small", maximumModelCalls: 1, maximumToolCalls: 1,
    maximumCandidates: 2, maximumDocuments: 2, maximumProviderReadCalls: 1, maximumBytes: 100, maximumInputTokens: 100,
    maximumOutputTokens: 100, maximumRerankCalls: 0, maximumKnowledgeBaseCalls: 0, maximumParallelReads: 1, deadlineMs: 1_000 },
  { requestedMode: "standard", effectiveMode: "standard" });
  const result = await discoverTravelCandidates({ retrievers: [retriever], ledger }, { requestRef: "request", facets: [{ kind: "place", value: "松江" }],
    explicitFilters: [], unresolvedFilters: [], scopeRef: "trip:1", budgetRef: "standard" },
  { maximumQueries: 3, maximumHitsPerQuery: 3, maximumOutputHits: 10, maximumTextBytes: 100, maximumParallelReads: 1 });
  expect(retrieve).toHaveBeenCalledTimes(1);
  expect(result.research).toMatchObject({ status: "partial", coveredScopes: ["retrieval:web:1"],
    remainingScopes: ["retrieval:web:2", "retrieval:web:3"] });
});

it("does not count a provider read when its Knowledge Base reservation cannot be made", async () => {
  const retrieve = vi.fn(async (): Promise<DiscoveryBatch> => { throw new Error("must not execute"); });
  const retriever: TravelKnowledgeRetriever = { channel: "knowledge_base", retrieve };
  const ledger = new ResearchExecutionLedger({ policyVersion: "small", maximumModelCalls: 1, maximumToolCalls: 1,
    maximumCandidates: 2, maximumDocuments: 2, maximumProviderReadCalls: 1, maximumBytes: 100, maximumInputTokens: 100,
    maximumOutputTokens: 100, maximumRerankCalls: 0, maximumKnowledgeBaseCalls: 0, maximumParallelReads: 1, deadlineMs: 1_000 },
  { requestedMode: "standard", effectiveMode: "standard" });
  const result = await discoverTravelCandidates({ retrievers: [retriever], ledger }, { requestRef: "request",
    facets: [{ kind: "place", value: "松江" }], explicitFilters: [], unresolvedFilters: [], scopeRef: "trip:1", budgetRef: "standard" },
  { maximumQueries: 2, maximumHitsPerQuery: 3, maximumOutputHits: 10, maximumTextBytes: 100, maximumParallelReads: 1 });
  expect(retrieve).not.toHaveBeenCalled();
  expect(result.research).toMatchObject({ status: "partial", remainingScopes: ["retrieval:knowledge_base:1", "retrieval:knowledge_base:2"] });
  expect(ledger.outcome({ remainingScopes: [] })).toMatchObject({ status: "failed", stopReason: "budget_exhausted",
    remainingScopes: ["retrieval:knowledge_base:1", "retrieval:knowledge_base:2"], usage: { providerReads: 0, knowledgeBaseCalls: 0 } });
});
