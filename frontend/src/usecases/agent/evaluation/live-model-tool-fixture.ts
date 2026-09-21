import { externalTravelEvidence } from "@raiquora/agent/external-travel-evidence";
import type { ToolEvidenceMapper } from "@raiquora/agent/tool-evidence-registry";

export type LiveEvaluationTravelToolName =
  | "search_place_media"
  | "search_web"
  | "read_web_pages"
  | "resolve_place_candidates";

export interface LiveEvaluationPlace {
  providerPlaceId: string;
  name: string;
  municipality: string;
  sourceUrl: string;
  photoUrl: string;
  overview: string;
}

/** Keep Live Eval deterministic while preserving the production Tool/Evidence contract. */
export function liveEvaluationTravelToolOutput(input: {
  name: LiveEvaluationTravelToolName;
  query: Record<string, unknown>;
  places: readonly LiveEvaluationPlace[];
  retrievedAt: string;
}): Record<string, unknown> {
  const { name, query, places, retrievedAt } = input;
  if (name === "search_web") {
    return { webSearch: information({
      query: query.query,
      results: places.map((place, index) => ({
        id: `fixture-search-${index + 1}`,
        title: `${place.name} 公式観光案内`,
        url: place.sourceUrl,
        description: place.overview,
      })),
    }, places, "web", "search", retrievedAt) };
  }
  if (name === "read_web_pages") {
    return { webPages: information({
      pages: places.map((place) => ({
        url: place.sourceUrl,
        title: `${place.name} 公式観光案内`,
        publisher: "Live Eval fixture",
        text: place.overview,
        contentType: "html",
        truncated: false,
        untrustedExternalContent: true,
      })),
    }, places, "web", "page", retrievedAt) };
  }

  const resolved = name === "resolve_place_candidates";
  return { result: information({
    places: places.map((place) => ({
      providerPlaceId: place.providerPlaceId,
      name: place.name,
      address: place.municipality,
      summary: place.overview,
      sourceUrl: place.sourceUrl,
      officialWebsiteUrl: place.sourceUrl,
      openingHoursStatus: "unknown",
      image: {
        url: place.photoUrl,
        attribution: "Live Eval fixture",
        hotlinkAllowed: true,
      },
      ...(resolved ? { targetBinding: { status: "resolved", reason: "source-binding" } } : {}),
    })),
  }, places, "place", resolved ? "resolved-place" : "place", retrievedAt) };
}

export function liveEvaluationAccommodationOutput(
  query: Record<string, unknown>,
): Record<string, unknown> {
  const checkInDate = typeof query.checkInDate === "string" ? query.checkInDate : "2026-09-22";
  const checkOutDate = typeof query.checkOutDate === "string" ? query.checkOutDate : "2026-09-23";
  return { accommodations: ["竹野屋旅館", "いにしえの宿 佳雲", "お宿 月夜のうさぎ"].map((name, index) => ({
    kind: "accommodation",
    provider: "live-eval",
    providerItemId: `izumo-${index + 1}`,
    name,
    areaName: index === 0 ? "出雲大社門前" : "出雲市",
    checkInDate,
    checkOutDate,
    availability: "unknown",
    bookingUrl: `https://example.com/accommodations/izumo-${index + 1}`,
  })) };
}

export const liveEvaluationToolEvidence: ToolEvidenceMapper = externalTravelEvidence;

function information(
  data: Record<string, unknown>,
  places: readonly LiveEvaluationPlace[],
  kind: "web" | "place",
  idPrefix: string,
  retrievedAt: string,
): Record<string, unknown> {
  return {
    status: "available",
    freshness: "fresh",
    retrievedAt,
    data,
    evidence: places.map((place, index) => ({
      id: `live-eval:${idPrefix}:${encodeURIComponent(place.providerPlaceId)}`,
      kind,
      provider: "live-eval",
      sourceId: `${idPrefix}-${index + 1}`,
      sourceUrl: place.sourceUrl,
      retrievedAt,
      attribution: "Live Eval fixture",
      confidence: "observed",
    })),
  };
}
