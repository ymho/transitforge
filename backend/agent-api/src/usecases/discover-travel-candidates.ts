import { fuseDiscoveryBatches, validateDiscoveryQuery, type CandidateReranker, type DiscoveryBatch, type DiscoveryFacet,
  type DiscoveryQuery, type TravelKnowledgeRetriever } from "@raiquora/agent/travel-discovery";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { AgentToolDescriptor } from "@raiquora/agent/tool-contract";
import { executeBoundedAgentReads } from "@raiquora/agent/agent-tool-executor";

export interface DiscoveryBudget {
  maximumQueries: number;
  maximumHitsPerQuery: number;
  maximumOutputHits: number;
  maximumTextBytes: number;
  maximumParallelReads: number;
}
export interface DiscoveryResult { batch: DiscoveryBatch; rerank?: { provider: string; modelRef: string; before: string[]; after: string[]; fallbackReason?: string } }

export async function discoverTravelCandidates(dependencies: { retrievers: TravelKnowledgeRetriever[]; reranker?: CandidateReranker },
  request: DiscoveryQuery, budget: DiscoveryBudget, signal?: AbortSignal): Promise<DiscoveryResult> {
  validateDiscoveryQuery(request);
  validateBudget(budget);
  const queries = facetQueries(request.facets).slice(0, budget.maximumQueries);
  const attempts = queries.flatMap((query) => dependencies.retrievers.map((retriever) => ({ query, retriever })));
  const settled = await executeBoundedAgentReads(attempts.map((attempt) => async () => {
    try {
      return { status: "fulfilled" as const,
        value: await attempt.retriever.retrieve(attempt.query, request, budget.maximumHitsPerQuery, signal) };
    } catch (reason) {
      return { status: "rejected" as const, reason };
    }
  }), budget.maximumParallelReads, signal);
  signal?.throwIfAborted();
  const batches = settled.map((result, index): DiscoveryBatch => result.status === "fulfilled" ? result.value : {
    hits: [], coverage: { attemptedFacetKinds: [...new Set(request.facets.map((facet) => facet.kind))],
      channels: [attempts[index]!.retriever.channel], requestedQueries: 1, completedQueries: 0, omittedHits: 0 },
    incompleteReasons: [`retrieval_failed:${attempts[index]!.retriever.channel}`],
  });
  const fused = capText(fuseDiscoveryBatches(batches, budget.maximumOutputHits), budget.maximumTextBytes);
  if (!dependencies.reranker || !fused.hits.length) return { batch: fused };
  const reranked = await dependencies.reranker.rerank(queries.join(" / "), fused.hits, budget.maximumOutputHits, signal);
  return { batch: { ...fused, hits: reranked.hits }, rerank: reranked.trace };
}

export function createTravelDiscoveryOperation(dependencies: { retrievers: TravelKnowledgeRetriever[]; reranker?: CandidateReranker },
  budget: DiscoveryBudget = { maximumQueries: 6, maximumHitsPerQuery: 6, maximumOutputHits: 12, maximumTextBytes: 36_000,
    maximumParallelReads: 3 }): AgentOperation {
  return async (input, context) => {
    const facets = parseFacets(input.facets);
    if (!facets.length) return { statusCode: 400, body: { message: "旅行候補を探す観点が必要です" } };
    const query: DiscoveryQuery = { requestRef: context.requestId, facets, explicitFilters: parseFilters(input.explicitFilters),
      unresolvedFilters: strings(input.unresolvedFilters, 12, 120), scopeRef: text(input.scopeRef, 160) || context.requestId,
      budgetRef: text(input.budgetRef, 80) || "standard-v1" };
    const result = await discoverTravelCandidates(dependencies, query, budget);
    return { body: { discovery: result } };
  };
}

export const travelDiscoveryToolDescriptor: AgentToolDescriptor = {
  name: "search_travel_knowledge",
  description: "地名・エリア・季節・体験・旅行スタイル・アクセス・滞在方法・soft preferenceの複数観点から候補資料を発見し、取得関連度で再順位付けします。検索点数は営業、成立性、費用、最終推薦順位ではありません。必須filterや未解決条件を黙って緩和しません",
  inputSchema: { type: "object", properties: {
    facets: { type: "array", minItems: 1, maxItems: 16, items: { type: "object", properties: {
      kind: { type: "string", enum: ["place", "area", "season", "activity", "travel_style", "access", "stay", "soft_preference"] }, value: { type: "string" },
    }, required: ["kind", "value"], additionalProperties: false } },
    explicitFilters: { type: "array", maxItems: 12, items: { type: "object", properties: { field: { type: "string" },
      operator: { type: "string", enum: ["equals", "in", "starts_with"] }, value: {} }, required: ["field", "operator", "value"], additionalProperties: false } },
    unresolvedFilters: { type: "array", maxItems: 12, items: { type: "string" } }, scopeRef: { type: "string" }, budgetRef: { type: "string" },
  }, required: ["facets"], additionalProperties: false },
};

function facetQueries(facets: readonly DiscoveryFacet[]): string[] {
  const anchors = facets.filter((item) => item.kind === "place" || item.kind === "area").map((item) => item.value.trim());
  const contexts = facets.filter((item) => item.kind !== "place" && item.kind !== "area");
  const base = anchors.join(" ");
  const queries = contexts.map((item) => [base, item.value.trim()].filter(Boolean).join(" "));
  if (base) queries.unshift(base);
  if (!queries.length) queries.push(facets.map((item) => item.value.trim()).join(" "));
  const seed = base || facets.map((item) => item.value.trim()).join(" ");
  if (queries.length < 2) queries.push(`${seed} 体験 季節`, `${seed} アクセス 滞在`);
  return [...new Set(queries.filter(Boolean))];
}
function capText(batch: DiscoveryBatch, bytes: number): DiscoveryBatch {
  let remaining = bytes;
  let truncated = false;
  const hits = batch.hits.flatMap((hit) => {
    const text = truncateUtf8(hit.text, Math.max(0, remaining));
    if (text !== hit.text) truncated = true;
    remaining -= utf8Bytes(text);
    return text ? [{ ...hit, text }] : [];
  });
  return { ...batch, hits, coverage: { ...batch.coverage, omittedHits: batch.coverage.omittedHits + batch.hits.length - hits.length },
    incompleteReasons: truncated ? [...new Set([...batch.incompleteReasons, "text_budget_exhausted"])] : batch.incompleteReasons };
}
function truncateUtf8(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return "";
  if (utf8Bytes(value) <= maximumBytes) return value;
  let result = "", used = 0;
  for (const character of value) {
    const size = utf8Bytes(character);
    if (used + size > maximumBytes) break;
    result += character; used += size;
  }
  return result;
}
function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
function validateBudget(budget: DiscoveryBudget): void {
  if (budget.maximumQueries < 2 || [budget.maximumQueries, budget.maximumHitsPerQuery, budget.maximumOutputHits, budget.maximumTextBytes,
    budget.maximumParallelReads]
    .some((value) => !Number.isInteger(value) || value <= 0)) throw new Error("Invalid discovery budget");
  if (budget.maximumParallelReads > 8) throw new Error("Invalid discovery budget");
}
function parseFacets(value: unknown): DiscoveryFacet[] { return Array.isArray(value) ? value.flatMap((item) => record(item) &&
  ["place", "area", "season", "activity", "travel_style", "access", "stay", "soft_preference"].includes(String(item.kind)) && text(item.value, 160)
  ? [{ kind: item.kind as DiscoveryFacet["kind"], value: text(item.value, 160) }] : []).slice(0, 16) : []; }
function parseFilters(value: unknown): DiscoveryQuery["explicitFilters"] { return Array.isArray(value) ? value.flatMap((item) => record(item) &&
  text(item.field, 80) && ["equals", "in", "starts_with"].includes(String(item.operator)) && (typeof item.value === "string" || Array.isArray(item.value) && item.value.every((entry) => typeof entry === "string"))
  ? [{ field: text(item.field, 80), operator: item.operator as "equals" | "in" | "starts_with", value: Array.isArray(item.value) ? item.value.slice(0, 20).map((entry) => text(entry, 160)) : text(item.value, 160) }] : []).slice(0, 12) : []; }
function strings(value: unknown, count: number, length: number): string[] { return Array.isArray(value) ? value.flatMap((item) => text(item, length) ? [text(item, length)] : []).slice(0, count) : []; }
function text(value: unknown, limit: number): string { return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, limit) : ""; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
