import { BedrockAgentRuntimeClient, RerankCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import type { CandidateReranker, CandidateRerankResult, DiscoveryHit } from "@raiquora/agent/travel-discovery";

interface RerankClient { send(command: RerankCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown> }

export class BedrockCandidateReranker implements CandidateReranker {
  constructor(private readonly modelArn: string, private readonly client: RerankClient = new BedrockAgentRuntimeClient({})) {}
  async rerank(query: string, hits: readonly DiscoveryHit[], maximum: number, signal?: AbortSignal): Promise<CandidateRerankResult> {
    const before = hits.map((hit) => hit.hitId);
    if (!hits.length) return { hits: [], trace: { provider: "bedrock", modelRef: this.modelArn, before, after: [] } };
    try {
      const response = await this.client.send(new RerankCommand({
        queries: [{ type: "TEXT", textQuery: { text: query.slice(0, 4_000) } }],
        sources: hits.map((hit) => ({ type: "INLINE", inlineDocumentSource: { type: "TEXT", textDocument: { text: hit.text.slice(0, 32_000) } } })),
        rerankingConfiguration: { type: "BEDROCK_RERANKING_MODEL", bedrockRerankingConfiguration: {
          modelConfiguration: { modelArn: this.modelArn }, numberOfResults: Math.min(maximum, hits.length),
        } },
      }), signal ? { abortSignal: signal } : undefined) as { results?: Array<{ index?: number; relevanceScore?: number }> };
      const seen = new Set<number>();
      const ordered: DiscoveryHit[] = [];
      for (const result of response.results ?? []) {
        if (!Number.isInteger(result.index) || result.index! < 0 || result.index! >= hits.length || seen.has(result.index!)) throw new Error("invalid_rerank_index");
        seen.add(result.index!); ordered.push(hits[result.index!]!);
      }
      if (!ordered.length || ordered.length < Math.min(maximum, hits.length)) throw new Error("incomplete_rerank_result");
      return { hits: ordered, trace: { provider: "bedrock", modelRef: this.modelArn, before, after: ordered.map((hit) => hit.hitId) } };
    } catch (error) {
      if (signal?.aborted) throw error;
      const fallback = [...hits].slice(0, maximum);
      return { hits: fallback, trace: { provider: "bedrock", modelRef: this.modelArn, before, after: fallback.map((hit) => hit.hitId),
        fallbackReason: error instanceof Error ? error.message.slice(0, 120) : "rerank_failed" } };
    }
  }
}
