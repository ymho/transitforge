import type { Evidence } from "./evidence-model";

export function externalTravelEvidence(output: unknown, context: { retrievedAt: string }): Evidence[] {
  if (!isRecord(output)) return [];
  // Accommodation operation returns validated offerings rather than an ExternalTravelInformation envelope.
  if (Array.isArray(output.accommodations)) return output.accommodations.slice(0, 5).flatMap(raw => {
    if (!isRecord(raw) || raw.kind !== "accommodation" || typeof raw.provider !== "string" ||
        typeof raw.providerItemId !== "string" || typeof raw.name !== "string") return [];
    return [{ id: `accommodation:${encodeURIComponent(raw.provider)}:${encodeURIComponent(raw.providerItemId)}`,
      category: "external" as const, knowledgeKind: "deterministic_fact" as const, subject: raw.name,
      facts: { resultKind: "accommodation", name: raw.name, status: "available", freshness: "fresh", provider: raw.provider, providerItemId: raw.providerItemId, availability: raw.availability === "available" ? "available" : "unknown" },
      references: [{ sourceType: "external-source" as const,
        sourceRef: typeof raw.bookingUrl === "string" ? raw.bookingUrl : `${raw.provider}:${raw.providerItemId}`,
        retrievedAt: context.retrievedAt, freshness: "current" as const, summary: "宿泊Providerで確認した候補。未確認の空室・料金を含まない" }],
    }];
  });
  const information = isRecord(output.forecast) ? output.forecast : isRecord(output.result) ? output.result : isRecord(output.webSearch) ? output.webSearch : isRecord(output.webPages) ? output.webPages : isRecord(output.alerts) ? output.alerts : isRecord(output.groundAccess) ? output.groundAccess : isRecord(output.restaurants) ? output.restaurants : undefined;
  if (!information || !Array.isArray(information.evidence)) return [];
  const resultKind = isRecord(output.forecast) ? "weather" : isRecord(output.alerts) ? "hazard" : undefined;
  const evidence: Evidence[] = information.evidence.slice(0, 8).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.provider !== "string") return [];
    return [{
      id: raw.id,
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
    }];
  });
  // An unsuccessful acquisition is a known Tool outcome, not a verified weather/hazard fact.
  // Never fabricate Provider Evidence, or turn an external observation into a saved TripImpact.
  if (resultKind && evidence.length === 0) evidence.push({
    id: `application:external-result:${resultKind}`,
    category: "external", knowledgeKind: "deterministic_fact", subject: resultKind === "weather" ? "天気情報の取得結果" : "防災情報の取得結果",
    facts: { resultKind, status: "unconfirmed", freshness: "unknown" },
    references: [{ sourceType: "external-source", sourceRef: `application://external-result/v1/${resultKind}`,
      retrievedAt: context.retrievedAt, freshness: "unknown", summary: "Toolの取得結果。外部事実の確認はできていない" }],
  });
  return evidence;
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
  return { placeName: typeof place.name === "string" ? place.name.slice(0, 160) : "旅行候補", imageUrl: place.image.url, imageSourceUrl,
    imageAttribution: place.image.attribution.slice(0, 240), ...(typeof place.image.license === "string" ? { imageLicense: place.image.license.slice(0, 120) } : {}),
    boundSourceUrls: [...new Set(boundSourceUrls)].slice(0, 8) };
}
function https(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } }

/** Bind prose to its own fetched source, never attach all pages to an unrelated Evidence ID. */
function sourceTextFacts(information: Record<string, unknown>, sourceUrl: unknown): Record<string, string> {
  if (information.status !== "available" || information.freshness !== "fresh" || typeof sourceUrl !== "string" || !isRecord(information.data)) return {};
  try { if (!["https:", "http:"].includes(new URL(sourceUrl).protocol)) return {}; } catch { return {}; }
  const data = information.data;
  const page = Array.isArray(data.pages) ? data.pages.find((p) => isRecord(p) && p.url === sourceUrl) : undefined;
  const place = Array.isArray(data.places) ? data.places.find((p) => isRecord(p) && p.sourceUrl === sourceUrl &&
    (!isRecord(p.targetBinding) || p.targetBinding.status === "resolved")) : undefined;
  const hit = Array.isArray(data.results) ? data.results.find((p) => isRecord(p) && p.url === sourceUrl) : undefined;
  const value = isRecord(page) ? page : isRecord(place) ? place : isRecord(hit) ? hit : undefined;
  if (!value) return {};
  const excerpt = boundedText(value.text ?? value.summary ?? value.description ?? value.snippet, 1200);
  if (!excerpt) return {};
  return { sourceTitle: boundedText(value.title ?? value.name, 160) ?? "取得したページ", sourceExcerpt: excerpt,
    sourceUrl, sourcePrecision: page ? "read-page" : place ? "place-description" : "search-snippet" };
}


function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function boundedText(value: unknown, maximum: number): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : undefined; }
