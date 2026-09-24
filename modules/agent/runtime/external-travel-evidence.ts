import type { Evidence } from "./evidence-model";
import { stableContractHash } from "./output-contract";
import type { ToolEvidenceContext } from "./tool-evidence-registry";
import type { TravelApplicabilityFact } from "./travel-applicability";

export function externalTravelEvidence(output: unknown, context: Pick<ToolEvidenceContext, "retrievedAt"> & Partial<ToolEvidenceContext>): Evidence[] {
  const identity = contextIdentity(context);
  if (!isRecord(output)) return [];
  // Accommodation operation returns validated offerings rather than an ExternalTravelInformation envelope.
  if (Array.isArray(output.accommodations)) return output.accommodations.slice(0, 5).flatMap(raw => {
    if (!isRecord(raw) || raw.kind !== "accommodation" || typeof raw.provider !== "string" ||
        typeof raw.providerItemId !== "string" || typeof raw.name !== "string") return [];
    const subjectKey = `accommodation:${encodeURIComponent(raw.provider)}:${encodeURIComponent(raw.providerItemId)}`;
    const observationId = boundedEvidenceId(`observation:${identity}:${subjectKey}`);
    return [{ id: observationId,
      category: "external" as const, knowledgeKind: "deterministic_fact" as const, subject: raw.name,
      facts: { resultKind: "accommodation", name: raw.name, status: "available", freshness: "fresh", provider: raw.provider, providerItemId: raw.providerItemId, availability: raw.availability === "available" ? "available" : "unknown" },
      references: [{ sourceType: "external-source" as const,
        sourceRef: typeof raw.bookingUrl === "string" ? raw.bookingUrl : `${raw.provider}:${raw.providerItemId}`,
        retrievedAt: context.retrievedAt, freshness: "current" as const, summary: "宿泊Providerで確認した候補。未確認の空室・料金を含まない" }],
      observation: { observationId, subjectKey, scopeKey: identity, predicate: "accommodation_search_result",
        validDuring: { ...(typeof raw.checkInDate === "string" ? { from: raw.checkInDate } : {}), ...(typeof raw.checkOutDate === "string" ? { until: raw.checkOutDate } : {}) },
        retrievedAt: context.retrievedAt, applicability: "applicable" as const, state: "current" as const, retention: "reference_only" as const },
    }];
  });
  const information = isRecord(output.forecast) ? output.forecast : isRecord(output.result) ? output.result : isRecord(output.webSearch) ? output.webSearch : isRecord(output.webPages) ? output.webPages : isRecord(output.alerts) ? output.alerts : isRecord(output.groundAccess) ? output.groundAccess : isRecord(output.restaurants) ? output.restaurants : undefined;
  if (!information || !Array.isArray(information.evidence)) return [];
  const resultKind = isRecord(output.forecast) ? "weather" : isRecord(output.alerts) ? "hazard" : undefined;
  const evidence: Evidence[] = information.evidence.slice(0, 8).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.provider !== "string") return [];
    const subjectKey = subjectKeyFor(information, raw);
    const observationId = boundedEvidenceId(`observation:${identity}:${encodeURIComponent(raw.id)}`);
    return [{
      id: observationId,
      category: "external" as const,
      knowledgeKind: "deterministic_fact" as const,
      subject: isRecord(information.data) && typeof information.data.locationName === "string" ? `${information.data.locationName}の天気予報` : isRecord(information.data) && typeof information.data.area === "string" ? `${information.data.area}の防災情報` : "外部旅行情報",
      facts: { provider: raw.provider, status: String(information.status ?? "unknown"), freshness: String(information.freshness ?? "unknown"),
        ...sourceTextFacts(information, raw.sourceUrl),
        ...placePresentationFacts(information, raw.sourceUrl),
        ...(resultKind ? { resultKind } : {}) },
      references: [{
        sourceType: "external-source" as const,
        sourceRef: typeof raw.sourceUrl === "string" ? raw.sourceUrl : raw.id,
        retrievedAt: typeof raw.retrievedAt === "string" ? raw.retrievedAt : context.retrievedAt,
        freshness: information.freshness === "fresh" ? "current" as const : "unknown" as const,
        summary: typeof raw.attribution === "string" ? raw.attribution : `${raw.provider}から取得`,
      }],
      observation: { observationId, subjectKey, scopeKey: identity, predicate: resultKind ?? evidencePredicate(information),
        ...(typeof raw.observedAt === "string" ? { observedAt: raw.observedAt } : {}),
        validDuring: { ...(typeof raw.validFrom === "string" ? { from: raw.validFrom } : {}), ...(typeof raw.validUntil === "string" ? { until: raw.validUntil } : {}) },
        retrievedAt: typeof raw.retrievedAt === "string" ? raw.retrievedAt : context.retrievedAt,
        applicability: information.status === "available" ? "applicable" as const : "unknown" as const,
        state: information.freshness === "stale" ? "stale" as const : "current" as const, retention: "bounded_excerpt" as const },
      applicabilityFacts: applicabilityFacts(information, raw, observationId, subjectKey, identity, context.retrievedAt),
    }];
  });
  // An unsuccessful acquisition is a known Tool outcome, not a verified weather/hazard fact.
  // Never fabricate Provider Evidence, or turn an external observation into a saved TripImpact.
  if (resultKind && evidence.length === 0) {
    const observationId = boundedEvidenceId(`application:external-result:${resultKind}:${identity}`);
    evidence.push({
      id: observationId,
      category: "external", knowledgeKind: "deterministic_fact", subject: resultKind === "weather" ? "天気情報の取得結果" : "防災情報の取得結果",
      facts: { resultKind, status: "unconfirmed", freshness: "unknown" },
      references: [{ sourceType: "external-source", sourceRef: `application://external-result/v1/${resultKind}`,
        retrievedAt: context.retrievedAt, freshness: "unknown", summary: "Toolの取得結果。外部事実の確認はできていない" }],
      observation: { observationId,
        subjectKey: `application:external-result:${resultKind}`, scopeKey: identity, predicate: `${resultKind}_retrieval`,
        retrievedAt: context.retrievedAt, applicability: "unknown", state: "current", retention: "reference_only" },
    });
  }
  return evidence;
}

function applicabilityFacts(information: Record<string, unknown>, raw: Record<string, unknown>, observationId: string,
  subjectRef: string, scope: string, retrievedAt: string): TravelApplicabilityFact[] {
  if (!isRecord(information.data)) return [];
  const sourceRef = typeof raw.sourceUrl === "string" ? raw.sourceUrl : raw.id as string;
  const data = information.data;
  if (isRecord(data.origin) && isRecord(data.destination) && typeof data.origin.entityId === "string" &&
      typeof data.destination.entityId === "string" && ["walking", "driving", "cycling"].includes(String(data.mode)) &&
      Number.isFinite(data.durationMinutes)) return [{ kind: "access_requirement", observationId, subjectRef,
        applicabilityScope: scope, sourceRef, retrievedAt, extractionKind: "provider_structured",
        originRef: data.origin.entityId, destinationRef: data.destination.entityId, mode: data.mode as "walking" | "driving" | "cycling",
        lowerBoundMinutes: Math.max(0, Math.ceil(Number(data.durationMinutes))) }];
  if (Array.isArray(data.places)) {
    const place = data.places.find((candidate) => isRecord(candidate) && candidate.sourceUrl === raw.sourceUrl);
    if (isRecord(place) && typeof place.providerPlaceId === "string") return [{ kind: "visit_requirement", observationId,
      subjectRef, applicabilityScope: scope, sourceRef, retrievedAt, extractionKind: "provider_structured", reservation: "unknown" }];
  }
  return [];
}

function contextIdentity(context: Pick<ToolEvidenceContext, "retrievedAt"> & Partial<ToolEvidenceContext>): string {
  return [context.executionId ?? "direct", context.toolCallId ?? "call", context.toolName ?? "external", context.queryFingerprint ?? "unscoped"]
    .map((value) => encodeURIComponent(value)).join(":");
}
/** Decision and in-trip reference contracts admit Evidence IDs up to 160 chars. Keep
 * useful stable context while hashing only identities that would cross that boundary. */
function boundedEvidenceId(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 95)}:${stableContractHash(value)}`;
}
function subjectKeyFor(information: Record<string, unknown>, raw: Record<string, unknown>): string {
  if (isRecord(information.data) && Array.isArray(information.data.places)) {
    const place = information.data.places.find((candidate) => isRecord(candidate) && candidate.sourceUrl === raw.sourceUrl);
    if (isRecord(place) && typeof place.providerPlaceId === "string") return `place:${String(raw.provider)}:${encodeURIComponent(place.providerPlaceId)}`;
  }
  return `source:${String(raw.provider)}:${encodeURIComponent(String(raw.sourceUrl ?? raw.id))}`;
}
function evidencePredicate(information: Record<string, unknown>): string {
  if (isRecord(information.data) && Array.isArray(information.data.places)) return "place_description";
  if (isRecord(information.data) && Array.isArray(information.data.pages)) return "web_page_content";
  if (isRecord(information.data) && isRecord(information.data.origin) && isRecord(information.data.destination)) return "ground_access";
  return "external_information";
}

function placePresentationFacts(information: Record<string, unknown>, sourceUrl: unknown): Record<string, string | string[]> {
  if (information.status !== "available" || information.freshness !== "fresh" || !isRecord(information.data) || !Array.isArray(information.data.places)) return {};
  const place = information.data.places.find((item) => isRecord(item) && item.sourceUrl === sourceUrl);
  if (!isRecord(place) || !isRecord(place.image) || place.image.hotlinkAllowed !== true || typeof place.image.url !== "string" || !https(place.image.url) ||
      typeof place.image.attribution !== "string" || !place.image.attribution.trim()) return {};
  const imageSourceUrl = typeof place.image.descriptionUrl === "string" && https(place.image.descriptionUrl) ? place.image.descriptionUrl : typeof place.sourceUrl === "string" && https(place.sourceUrl) ? place.sourceUrl : undefined;
  if (!imageSourceUrl) return {};
  const boundSourceUrls = [place.officialWebsiteUrl, ...(Array.isArray(place.sources) ? place.sources.flatMap((item) => isRecord(item) ? [item.url] : []) : [])]
    .filter((item): item is string => typeof item === "string" && https(item));
  const administrativeAreas = Array.isArray(place.administrativeAreas) ? place.administrativeAreas.flatMap((item) =>
    isRecord(item) && typeof item.kind === "string" && typeof item.name === "string" && item.name.trim()
      ? [`${item.kind}:${item.name.trim().slice(0, 120)}`]
      : []).slice(0, 8) : [];
  return { placeName: typeof place.name === "string" ? place.name.slice(0, 160) : "旅行候補", imageUrl: place.image.url, imageSourceUrl,
    imageAttribution: place.image.attribution.slice(0, 240), ...(typeof place.image.license === "string" ? { imageLicense: place.image.license.slice(0, 120) } : {}),
    boundSourceUrls: [...new Set(boundSourceUrls)].slice(0, 8), ...(administrativeAreas.length ? { administrativeAreas } : {}) };
}
function https(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } }

/** Bind prose to its own fetched source, never attach all pages to an unrelated Evidence ID. */
function sourceTextFacts(information: Record<string, unknown>, sourceUrl: unknown): Record<string, string | boolean> {
  if (information.status !== "available" || information.freshness !== "fresh" || typeof sourceUrl !== "string" || !isRecord(information.data)) return {};
  try { if (!["https:", "http:"].includes(new URL(sourceUrl).protocol)) return {}; } catch { return {}; }
  const data = information.data;
  const page = Array.isArray(data.pages) ? data.pages.find((p) => isRecord(p) && p.url === sourceUrl) : undefined;
  const place = Array.isArray(data.places) ? data.places.find((p) => isRecord(p) && p.sourceUrl === sourceUrl &&
    (!isRecord(p.targetBinding) || p.targetBinding.status === "resolved")) : undefined;
  const hit = Array.isArray(data.results) ? data.results.find((p) => isRecord(p) && p.url === sourceUrl) : undefined;
  const value = isRecord(page) ? page : isRecord(place) ? place : isRecord(hit) ? hit : undefined;
  if (!value) return {};
  const rawText = value.text ?? value.summary ?? value.description ?? value.snippet;
  const excerpt = boundedText(rawText, 1200);
  if (!excerpt) return {};
  return { sourceTitle: boundedText(value.title ?? value.name, 160) ?? "取得したページ", sourceExcerpt: excerpt,
    sourceUrl, sourcePrecision: page ? "read-page" : place ? "place-description" : "search-snippet",
    sourceCoverage: value.truncated === true || typeof rawText === "string" && rawText.trim().length > excerpt.length ? "partial" : page ? "complete_document" : "snippet_only" };
}


function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function boundedText(value: unknown, maximum: number): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : undefined; }
