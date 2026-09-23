export type DiscoveryFacetKind = "place" | "area" | "season" | "activity" | "travel_style" | "access" | "stay" | "soft_preference";
export interface DiscoveryFacet { kind: DiscoveryFacetKind; value: string }
export interface DiscoveryFilter { field: string; operator: "equals" | "in" | "starts_with"; value: string | string[] }
export interface DiscoveryQuery {
  requestRef: string;
  facets: DiscoveryFacet[];
  explicitFilters: DiscoveryFilter[];
  unresolvedFilters: string[];
  scopeRef: string;
  budgetRef: string;
}
export interface DiscoveryHit {
  hitId: string;
  subjectRef?: string;
  sourceRef: string;
  sourceSpan?: { text: string; start?: number; end?: number };
  sourceVersion?: string;
  text: string;
  retrievedAt: string;
  validDuring?: { from?: string; until?: string };
  metadata: Record<string, string | number | boolean | string[]>;
  retention: "reference_only" | "bounded_excerpt" | "prohibited";
  retrievalChannel: "web" | "knowledge_base";
  originalRank: number;
}
export interface DiscoveryCoverage {
  attemptedFacetKinds: DiscoveryFacetKind[];
  channels: Array<"web" | "knowledge_base">;
  requestedQueries: number;
  completedQueries: number;
  omittedHits: number;
}
export interface DiscoveryBatch { hits: DiscoveryHit[]; coverage: DiscoveryCoverage; cursor?: string; incompleteReasons: string[] }
export interface RerankTrace { provider: string; modelRef: string; before: string[]; after: string[]; fallbackReason?: string }
export interface CandidateRerankResult { hits: DiscoveryHit[]; trace: RerankTrace }

export interface TravelKnowledgeRetriever {
  readonly channel: "web" | "knowledge_base";
  retrieve(query: string, request: DiscoveryQuery, limit: number, signal?: AbortSignal): Promise<DiscoveryBatch>;
}
export interface CandidateReranker {
  rerank(query: string, hits: readonly DiscoveryHit[], maximum: number, signal?: AbortSignal): Promise<CandidateRerankResult>;
}

/** Reciprocal-rank fusion keeps source rank and de-duplicates only exact source identity. */
export function fuseDiscoveryBatches(batches: readonly DiscoveryBatch[], maximum = 20): DiscoveryBatch {
  const scores = new Map<string, { score: number; hit: DiscoveryHit }>();
  for (const batch of batches) for (const hit of batch.hits) {
    const parent = typeof hit.metadata.parentDocumentRef === "string" ? hit.metadata.parentDocumentRef : hit.sourceRef;
    const identity = `${parent}\u0000${hit.sourceVersion ?? ""}`;
    const score = 1 / (60 + Math.max(1, hit.originalRank));
    const current = scores.get(identity);
    if (!current) scores.set(identity, { score, hit });
    else current.score += score;
  }
  const hits = [...scores.values()].sort((left, right) => right.score - left.score || left.hit.hitId.localeCompare(right.hit.hitId))
    .slice(0, maximum).map(({ hit }, index) => ({ ...hit, originalRank: index + 1 }));
  return {
    hits,
    coverage: {
      attemptedFacetKinds: [...new Set(batches.flatMap((batch) => batch.coverage.attemptedFacetKinds))],
      channels: [...new Set(batches.flatMap((batch) => batch.coverage.channels))],
      requestedQueries: batches.reduce((sum, batch) => sum + batch.coverage.requestedQueries, 0),
      completedQueries: batches.reduce((sum, batch) => sum + batch.coverage.completedQueries, 0),
      omittedHits: batches.reduce((sum, batch) => sum + batch.coverage.omittedHits, 0) + Math.max(0, scores.size - maximum),
    },
    incompleteReasons: [...new Set(batches.flatMap((batch) => batch.incompleteReasons))],
  };
}

export function validateDiscoveryQuery(query: DiscoveryQuery): DiscoveryQuery {
  if (!query.requestRef || !query.scopeRef || !query.budgetRef || !query.facets.length || query.facets.length > 16 ||
      query.facets.some((facet) => !facet.value.trim() || facet.value.length > 160) || query.explicitFilters.length > 12 || query.unresolvedFilters.length > 12) {
    throw new Error("Invalid discovery query");
  }
  return query;
}
