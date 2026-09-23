import type { DiscoveryBatch, DiscoveryQuery, TravelKnowledgeRetriever } from "@raiquora/agent/travel-discovery";
import type { WebSearchProvider } from "../ports/web-research.js";

export class WebTravelKnowledgeRetriever implements TravelKnowledgeRetriever {
  readonly channel = "web" as const;
  constructor(private readonly provider: WebSearchProvider, private readonly now: () => Date = () => new Date()) {}
  async retrieve(query: string, request: DiscoveryQuery, limit: number): Promise<DiscoveryBatch> {
    const result = await this.provider.search({ query, limit: Math.min(10, limit) });
    const hits = result.status === "available" && result.data ? result.data.results.slice(0, limit).map((item, index) => ({
      hitId: `web:${request.requestRef}:${encodeURIComponent(item.id)}`,
      sourceRef: item.url,
      text: [item.title, item.description, ...(item.extraSnippets ?? [])].filter(Boolean).join("\n").slice(0, 4_000),
      retrievedAt: result.evidence[0]?.retrievedAt ?? this.now().toISOString(),
      metadata: { title: item.title, ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}) },
      retention: "bounded_excerpt" as const,
      retrievalChannel: "web" as const,
      originalRank: index + 1,
    })) : [];
    return { hits, coverage: { attemptedFacetKinds: [...new Set(request.facets.map((item) => item.kind))], channels: ["web"],
      requestedQueries: 1, completedQueries: result.status === "available" ? 1 : 0, omittedHits: Math.max(0, (result.data?.results.length ?? 0) - hits.length) },
      incompleteReasons: result.status === "available" ? [] : [`web_${result.status}`] };
  }
}
