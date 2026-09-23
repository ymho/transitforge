import { expect, it, vi } from "vitest";
import { BedrockCandidateReranker } from "./bedrock-candidate-reranker.js";
import { BedrockKnowledgeRetriever } from "./bedrock-knowledge-retriever.js";
import type { DiscoveryHit, DiscoveryQuery } from "@raiquora/agent/travel-discovery";

const query: DiscoveryQuery = { requestRef: "request", facets: [{ kind: "season", value: "紅葉" }],
  explicitFilters: [{ field: "region", operator: "equals", value: "west-japan" }], unresolvedFilters: ["段差"], scopeRef: "trip:1", budgetRef: "standard" };
const hits: DiscoveryHit[] = [1, 2].map((rank) => ({ hitId: `hit-${rank}`, sourceRef: `https://example.test/${rank}`, text: `候補${rank}`,
  retrievedAt: "2026-09-23T00:00:00Z", metadata: {}, retention: "bounded_excerpt", retrievalChannel: "web", originalRank: rank }));

it("maps rerank indices strictly and falls back to original rank for duplicate/out-of-range responses", async () => {
  const good = new BedrockCandidateReranker("arn:model", { send: vi.fn(async () => ({ results: [{ index: 1 }, { index: 0 }] })) });
  expect((await good.rerank("紅葉", hits, 2)).hits.map((hit) => hit.hitId)).toEqual(["hit-2", "hit-1"]);
  const broken = new BedrockCandidateReranker("arn:model", { send: vi.fn(async () => ({ results: [{ index: 5 }, { index: 5 }] })) });
  const result = await broken.rerank("紅葉", hits, 2);
  expect(result.hits.map((hit) => hit.hitId)).toEqual(["hit-1", "hit-2"]); expect(result.trace.fallbackReason).toBe("invalid_rerank_index");
});
it("passes explicit metadata filters and downgrades unsupported HYBRID without pretending it ran", async () => {
  const send = vi.fn(async () => ({ retrievalResults: [{ content: { text: "紅葉の渓谷" }, location: { s3Location: { uri: "s3://bucket/doc" } },
    metadata: { sourceUrl: "https://example.test/doc", sourceVersion: "v2", retention: "bounded_excerpt" }, score: 0.8 }] }));
  const retriever = new BedrockKnowledgeRetriever({ knowledgeBaseId: "ABCDEFGHIJ", vectorStore: "s3_vectors", requestedSearchType: "HYBRID" }, { send }, () => new Date("2026-09-23T00:00:00Z"));
  const result = await retriever.retrieve("紅葉", query, 5);
  expect(result.hits[0]).toMatchObject({ sourceRef: "https://example.test/doc" }); expect(result.hits[0]).not.toHaveProperty("subjectRef");
  expect(result.incompleteReasons).toContain("hybrid_unsupported_semantic_used");
  expect(JSON.stringify(send.mock.calls)).toContain("SEMANTIC"); expect(JSON.stringify(send.mock.calls)).toContain("west-japan");
  send.mockClear();
  const supported = new BedrockKnowledgeRetriever({ knowledgeBaseId: "ABCDEFGHIJ", vectorStore: "rds_filterable_text", requestedSearchType: "HYBRID" },
    { send }, () => new Date("2026-09-23T00:00:00Z"));
  expect((await supported.retrieve("紅葉", query, 5)).incompleteReasons).not.toContain("hybrid_unsupported_semantic_used");
  expect(JSON.stringify(send.mock.calls)).toContain("HYBRID");
});
it("does not silently remove a startsWith filter unsupported by the selected vector store", async () => {
  const send = vi.fn(async () => ({ retrievalResults: [] }));
  const retriever = new BedrockKnowledgeRetriever({ knowledgeBaseId: "ABCDEFGHIJ", vectorStore: "s3_vectors", requestedSearchType: "SEMANTIC" }, { send });
  const result = await retriever.retrieve("紅葉", { ...query, explicitFilters: [{ field: "region", operator: "starts_with", value: "west" }] }, 5);
  expect(result.incompleteReasons).toContain("filter_unsupported:starts_with");
  expect(result.coverage.completedQueries).toBe(0);
  expect(send).not.toHaveBeenCalled();
});
