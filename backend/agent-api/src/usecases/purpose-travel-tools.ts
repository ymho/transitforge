import type { AgentToolDescriptor } from "@raiquora/agent/tool-contract";
import type { DiscoveryFacet } from "@raiquora/agent/travel-discovery";

export type PurposeTravelToolName = "explore_destination" | "discover_destinations";
export type PurposeTravelOutcomeStatus = "complete" | "partial" | "no_candidates" | "failed";

export interface PurposeTravelOutcome {
  status: PurposeTravelOutcomeStatus;
  candidateCount: number;
  verifiedCandidateCount: number;
  photoCandidateCount: number;
  completedScopes: string[];
  failedScopes: string[];
  reasonCodes: string[];
}

const textArray = (maximum: number) => ({ type: "array", maxItems: maximum, items: { type: "string", minLength: 1, maxLength: 160 } });

export const exploreDestinationToolDescriptor: AgentToolDescriptor = {
  name: "explore_destination",
  effect: "read",
  description: "行きたい特定の場所について、確認済み資料、表示可能な写真、魅力・楽しみ方、周辺候補をまとめて調べます。Web検索・Knowledge Base・ページ読込・地点/写真照合は内部で行います。具体的な日程がなくても使えます。検索失敗、候補なし、一部成功をoutcomeで区別します。Tripへの採用や保存は行いません",
  inputSchema: { type: "object", additionalProperties: false, properties: {
    destination: { type: "string", minLength: 1, maxLength: 160, description: "利用者が関心を示した具体的な場所・施設・エリア" },
    interests: textArray(8),
    includeNearby: { type: "boolean", description: "周辺の立ち寄り候補も調べる場合true" },
  }, required: ["destination"] },
  decisionSupport: {
    capability: "特定の目的地への関心を、根拠と写真を伴う旅行の動機へ具体化する",
    suitableCases: ["特定の場所へ行きたい", "その場所の魅力や楽しみ方を知りたい", "周辺も含めて検討したい"],
    unsuitableCases: ["行き先が未定で体験価値から複数地域を比較したい", "既知条件から日ごとの旅程を作りたい"],
    returnedEvidence: "読了した資料と、資料または安定した地点識別子へ照合できた場所・写真",
    limitations: ["検索順位は推薦順位ではない", "写真や地点を照合できなくても読了資料は部分結果として残る"],
    responsibilityBoundary: "検索と説明用Evidenceだけを返し、Tripの旅程・予約・保存は変更しない",
  },
};

export const discoverDestinationsToolDescriptor: AgentToolDescriptor = {
  name: "discover_destinations",
  effect: "read",
  description: "歴史、美食、自然、リフレッシュ等の求める体験から、比較できる複数の旅行先候補を調べます。Web検索・Knowledge Base・ページ読込・地点/写真照合は内部で行います。人数は必須にしません。検索失敗、候補なし、一部成功をoutcomeで区別します。Tripへの採用や保存は行いません",
  inputSchema: { type: "object", additionalProperties: false, properties: {
    experiences: { ...textArray(8), minItems: 1, description: "利用者が求める体験・気分・関心" },
    preferredAreas: textArray(6),
    season: { type: "string", minLength: 1, maxLength: 160 },
    travelStyle: { type: "string", minLength: 1, maxLength: 160 },
    accessPreference: { type: "string", minLength: 1, maxLength: 160 },
    stayPreference: { type: "string", minLength: 1, maxLength: 160 },
  }, required: ["experiences"] },
  decisionSupport: {
    capability: "抽象的な体験価値から、根拠を確認できる複数の旅行先候補を発見する",
    suitableCases: ["歴史ある場所を巡りたい", "美味しいものを食べたい", "リフレッシュできる行き先を比較したい"],
    unsuitableCases: ["行きたい場所が既に1つ決まっている", "日程と行き先から仮旅程を作りたい"],
    returnedEvidence: "候補発見資料、読了した候補ページ、照合できた地点・写真",
    limitations: ["検索関連度は営業・費用・成立性を保証しない", "複数候補を確認できなければpartialまたはno_candidatesになる"],
    responsibilityBoundary: "候補検索と比較材料だけを返し、候補の採用やTrip変更は行わない",
  },
};

export function purposeDiscoveryFacets(name: PurposeTravelToolName, input: Record<string, unknown>): DiscoveryFacet[] {
  if (name === "explore_destination") {
    const destination = boundedText(input.destination);
    if (!destination) return [];
    const facets: DiscoveryFacet[] = [{ kind: "place", value: destination }];
    for (const interest of strings(input.interests, 8)) facets.push({ kind: "activity", value: interest });
    if (input.includeNearby === true) facets.push({ kind: "soft_preference", value: "周辺の立ち寄り候補" });
    return facets;
  }
  const facets: DiscoveryFacet[] = strings(input.preferredAreas, 6).map((value) => ({ kind: "area" as const, value }));
  facets.push(...strings(input.experiences, 8).map((value) => ({ kind: "activity" as const, value })));
  for (const [key, kind] of [["season", "season"], ["travelStyle", "travel_style"], ["accessPreference", "access"], ["stayPreference", "stay"]] as const) {
    const value = boundedText(input[key]);
    if (value) facets.push({ kind, value });
  }
  return facets;
}

export function purposeTravelOutcome(input: {
  requestedCandidates: "one" | "multiple";
  discovery: unknown;
  verifiedCandidateCount: number;
  photoCandidateCount: number;
  sourceReadFailed: boolean;
  placeEnrichmentFailed: boolean;
}): PurposeTravelOutcome {
  const batch = record(input.discovery) && record(input.discovery.batch) ? input.discovery.batch : undefined;
  const hits = batch && Array.isArray(batch.hits) ? batch.hits.length : 0;
  const coverage = batch && record(batch.coverage) ? batch.coverage : undefined;
  const completedQueries = coverage && Number.isFinite(coverage.completedQueries) ? Number(coverage.completedQueries) : 0;
  const incomplete = batch && Array.isArray(batch.incompleteReasons) ? batch.incompleteReasons.filter((item): item is string => typeof item === "string") : [];
  const retrievalFailed = incomplete.some((reason) => /(?:failed|unavailable|exhausted)$/u.test(reason) || /retrieval_failed/u.test(reason));
  const completedScopes = [
    ...(completedQueries > 0 ? ["candidate_discovery"] : []),
    ...(input.verifiedCandidateCount > 0 ? ["verified_sources"] : []),
    ...(input.photoCandidateCount > 0 ? ["verified_photos"] : []),
  ];
  const failedScopes = [
    ...(retrievalFailed || completedQueries === 0 ? ["candidate_discovery"] : []),
    ...(input.sourceReadFailed ? ["verified_sources"] : []),
    ...(input.placeEnrichmentFailed ? ["place_photos"] : []),
  ];
  const needsMultiple = input.requestedCandidates === "multiple" && input.verifiedCandidateCount < 2;
  const reasonCodes = [...new Set([
    ...incomplete,
    ...(input.sourceReadFailed ? ["source_read_failed"] : []),
    ...(input.placeEnrichmentFailed ? ["place_or_photo_resolution_failed"] : []),
    ...(hits > 0 && input.verifiedCandidateCount === 0 ? ["no_verified_sources"] : []),
    ...(needsMultiple && input.verifiedCandidateCount > 0 ? ["insufficient_comparable_candidates"] : []),
  ])];
  let status: PurposeTravelOutcomeStatus;
  if (hits === 0 && completedQueries > 0 && !retrievalFailed) status = "no_candidates";
  else if (hits === 0 && input.verifiedCandidateCount === 0) status = "failed";
  else if (failedScopes.length || input.verifiedCandidateCount === 0 || needsMultiple) status = "partial";
  else status = "complete";
  return { status, candidateCount: hits, verifiedCandidateCount: input.verifiedCandidateCount,
    photoCandidateCount: input.photoCandidateCount, completedScopes: [...new Set(completedScopes)],
    failedScopes: [...new Set(failedScopes)], reasonCodes };
}

function strings(value: unknown, maximum: number): string[] {
  return Array.isArray(value) ? value.flatMap((item) => boundedText(item) ? [boundedText(item)!] : []).slice(0, maximum) : [];
}
function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 160);
  return result || undefined;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
