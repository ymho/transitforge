import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import type { DiscoveryBatch, DiscoveryFilter, DiscoveryQuery, TravelKnowledgeRetriever } from "@raiquora/agent/travel-discovery";

interface RetrieveClient { send(command: RetrieveCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown> }
export interface KnowledgeRetrieverOptions {
  knowledgeBaseId: string;
  vectorStore: "opensearch_serverless_filterable_text" | "rds_filterable_text" | "mongodb_filterable_text" | "s3_vectors" | "other";
  requestedSearchType: "HYBRID" | "SEMANTIC";
}

export class BedrockKnowledgeRetriever implements TravelKnowledgeRetriever {
  readonly channel = "knowledge_base" as const;
  constructor(private readonly options: KnowledgeRetrieverOptions,
    private readonly client: RetrieveClient = new BedrockAgentRuntimeClient({}), private readonly now: () => Date = () => new Date()) {}
  async retrieve(query: string, request: DiscoveryQuery, limit: number, signal?: AbortSignal): Promise<DiscoveryBatch> {
    const hybridSupported = ["opensearch_serverless_filterable_text", "rds_filterable_text", "mongodb_filterable_text"]
      .includes(this.options.vectorStore);
    const actualSearchType = this.options.requestedSearchType === "HYBRID" && hybridSupported ? "HYBRID" : "SEMANTIC";
    if (this.options.vectorStore !== "opensearch_serverless_filterable_text" &&
        request.explicitFilters.some((item) => item.operator === "starts_with")) {
      return { hits: [], coverage: { attemptedFacetKinds: [...new Set(request.facets.map((item) => item.kind))], channels: ["knowledge_base"],
        requestedQueries: 1, completedQueries: 0, omittedHits: 0 },
      incompleteReasons: ["filter_unsupported:starts_with", ...(request.unresolvedFilters.length ? ["unresolved_filters_not_relaxed"] : [])] };
    }
    const filter = retrievalFilter(request.explicitFilters);
    const commandInput = {
      knowledgeBaseId: this.options.knowledgeBaseId,
      retrievalQuery: { text: query.slice(0, 4_000) },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: Math.min(100, Math.max(1, limit)),
        overrideSearchType: actualSearchType, ...(filter ? { filter } : {}) } },
    } as unknown as ConstructorParameters<typeof RetrieveCommand>[0];
    const response = await this.client.send(new RetrieveCommand(commandInput), signal ? { abortSignal: signal } : undefined) as { retrievalResults?: Array<{ content?: { text?: string }; location?: unknown; metadata?: Record<string, unknown>; score?: number }> };
    const retrievedAt = this.now().toISOString();
    const hits = (response.retrievalResults ?? []).flatMap((result, index) => {
      const text = result.content?.text?.trim();
      const sourceRef = sourceReference(result.location, result.metadata);
      if (!text || !sourceRef) return [];
      const metadata = safeMetadata(result.metadata);
      const retention: "reference_only" | "prohibited" | "bounded_excerpt" = metadata.retention === "reference_only" || metadata.retention === "prohibited" ? metadata.retention : "bounded_excerpt";
      return [{ hitId: `kb:${request.requestRef}:${index + 1}`, ...(typeof metadata.subjectRef === "string" ? { subjectRef: metadata.subjectRef } : {}),
        sourceRef, ...(typeof metadata.sourceVersion === "string" ? { sourceVersion: metadata.sourceVersion } : {}), text: text.slice(0, 8_000), retrievedAt,
        metadata: { ...metadata, retrievalScore: finite(result.score) ? result.score : 0, actualSearchType },
        retention,
        retrievalChannel: "knowledge_base" as const, originalRank: index + 1 }];
    });
    const reasons = [...(this.options.requestedSearchType === "HYBRID" && !hybridSupported ? ["hybrid_unsupported_semantic_used"] : []),
      ...(request.unresolvedFilters.length ? ["unresolved_filters_not_relaxed"] : [])];
    return { hits, coverage: { attemptedFacetKinds: [...new Set(request.facets.map((item) => item.kind))], channels: ["knowledge_base"],
      requestedQueries: 1, completedQueries: 1, omittedHits: 0 }, incompleteReasons: reasons };
  }
}

function retrievalFilter(filters: readonly DiscoveryFilter[]): Record<string, unknown> | undefined {
  const values = filters.map((item) => item.operator === "equals" ? { equals: { key: item.field, value: item.value } } :
    item.operator === "in" ? { in: { key: item.field, value: item.value } } : { startsWith: { key: item.field, value: item.value } });
  return values.length === 0 ? undefined : values.length === 1 ? values[0] : { andAll: values };
}
function sourceReference(location: unknown, metadata?: Record<string, unknown>): string | undefined {
  if (typeof metadata?.sourceUrl === "string") return metadata.sourceUrl;
  return JSON.stringify(location)?.slice(0, 2_000) || undefined;
}
function safeMetadata(value?: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean" ||
    Array.isArray(item) && item.every((entry) => typeof entry === "string") ? [[key, item as string | number | boolean | string[]]] : []).slice(0, 32));
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
