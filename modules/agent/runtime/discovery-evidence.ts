import type { Evidence } from "./evidence-model";
import type { ToolEvidenceContext } from "./tool-evidence-registry";

export function discoveryEvidence(output: unknown, context: ToolEvidenceContext): Evidence[] {
  if (!record(output) || !record(output.discovery) || !record(output.discovery.batch) || !Array.isArray(output.discovery.batch.hits)) return [];
  return output.discovery.batch.hits.slice(0, 20).flatMap((raw) => {
    if (!record(raw) || typeof raw.hitId !== "string" || typeof raw.sourceRef !== "string" || typeof raw.text !== "string") return [];
    const subjectKey = typeof raw.subjectRef === "string" ? raw.subjectRef : `unresolved-source:${encodeURIComponent(raw.sourceRef)}`;
    const observationId = `observation:${context.queryFingerprint}:${encodeURIComponent(raw.hitId)}`;
    const retention = raw.retention === "prohibited" ? "prohibited" : raw.retention === "reference_only" ? "reference_only" : "bounded_excerpt";
    const metadata = record(raw.metadata) ? raw.metadata : {};
    return [{ id: observationId, category: "external" as const,
      knowledgeKind: "unverified_information" as const,
      subject: typeof raw.subjectRef === "string" ? raw.subjectRef : "未同定の旅行候補資料",
      facts: { status: "available", freshness: "fresh", sourceUrl: raw.sourceRef, sourceTitle: typeof metadata.title === "string" ? metadata.title : "候補資料",
        sourceExcerpt: retention === "prohibited" ? "保持禁止のため本文は保存していません" : raw.text.slice(0, 1200), sourcePrecision: raw.retrievalChannel === "web" ? "search-snippet" : "knowledge-retrieval",
        retrievalRank: Number(raw.originalRank) || 0, retrievalChannel: String(raw.retrievalChannel) },
      references: [{ sourceType: "external-source" as const, sourceRef: raw.sourceRef, retrievedAt: typeof raw.retrievedAt === "string" ? raw.retrievedAt : context.retrievedAt,
        freshness: "current" as const, summary: "候補発見の資料。検索関連度は旅行の成立性・推薦順位ではない" }],
      observation: { observationId, subjectKey, scopeKey: context.queryFingerprint, predicate: "travel_discovery_hit",
        retrievedAt: typeof raw.retrievedAt === "string" ? raw.retrievedAt : context.retrievedAt, applicability: "unknown" as const,
        state: "current" as const, retention } }];
  });
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
