import { addressPrefecture, explicitlyOutsideServiceArea, japanPrefectures, normalizePrefecture, prefectureStatus,
  serviceAreaPolicyVersion, serviceAreaPrefectures, type ServiceAreaStatus } from "@raiquora/trip/service-area";
import type { PlaceMediaProvider, PlaceAdministrativeArea } from "@raiquora/trip/place-media";
import type { RestaurantProvider } from "@raiquora/trip/restaurant-search";
import type { TravelKnowledgeRetriever } from "@raiquora/agent/travel-discovery";
import type { AccommodationProvider } from "../ports/travel-provider.js";
import type { ServiceAreaLookup } from "../ports/service-area-lookup.js";
import type { WebSearchProvider, WebPageReader } from "../ports/web-research.js";

export class ServiceAreaPolicy {
  readonly approvedSourceUrls = new Set<string>();
  constructor(private readonly lookup: ServiceAreaLookup) {}
  async classify(place: { name?: string; address?: string; latitude?: number; longitude?: number; administrativeAreas?: PlaceAdministrativeArea[] }): Promise<ServiceAreaStatus> {
    const country = place.administrativeAreas?.find(area => area.kind === "country")?.name;
    if (country && !["日本", "Japan", "JP"].includes(country)) return "outside";
    const region = place.administrativeAreas?.find(area => area.kind === "region")?.name;
    const prefecture = normalizePrefecture(region) ?? addressPrefecture(place.address);
    if (prefecture) return prefectureStatus(prefecture);
    const resolved = await this.lookup.resolve({ query: place.name, latitude: place.latitude, longitude: place.longitude });
    return !resolved ? "unresolved" : resolved.country !== "JP" ? "outside" : prefectureStatus(resolved.prefecture);
  }
  async allowsSource(title: string, text: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const content = `${title}\n${text}`;
    if (explicitlyOutsideServiceArea(content)) return false;
    if (metadata) {
      const values = metadata.prefectures ?? metadata.prefecture;
      const prefectures = typeof values === "string" ? [values] : Array.isArray(values) ? values : [];
      if (prefectures.length) return prefectures.every(value => prefectureStatus(value) === "inside");
    }
    // These are discovery leads, not place identity or access proofs. Mixed/outside documents are excluded.
    if (japanPrefectures.some(name => content.includes(name))) return true;
    const name = title.split(/[|｜:：]/u, 1)[0]?.trim();
    return Boolean(name && await this.classify({ name }) === "inside");
  }
}

export function serviceAreaPlaces(provider: PlaceMediaProvider, policy: ServiceAreaPolicy): PlaceMediaProvider {
  return { search: async query => {
    const result = await provider.search(query);
    if (!result.data) return result;
    const decisions = await Promise.all(result.data.places.map(place => policy.classify(place)));
    const places = result.data.places.filter((_place, index) => decisions[index] === "inside");
    return { ...result, data: { ...result.data, places } };
  } };
}
export function serviceAreaRestaurants(provider: RestaurantProvider, policy: ServiceAreaPolicy): RestaurantProvider {
  return { search: async query => {
    const result = await provider.search(query); if (!result.data) return result;
    const decisions = await Promise.all(result.data.restaurants.map(place => policy.classify(place)));
    const restaurants = result.data.restaurants.filter((_place, index) => decisions[index] === "inside");
    return { ...result, data: { ...result.data, restaurants } };
  } };
}
export function serviceAreaAccommodations(provider: AccommodationProvider, policy: ServiceAreaPolicy): AccommodationProvider {
  return { search: async (query, requestId) => {
    const results = await provider.search(query, requestId);
    const decisions = await Promise.all(results.map(place => policy.classify(place)));
    return results.filter((_place, index) => decisions[index] === "inside");
  } };
}
export function serviceAreaWebSearch(provider: WebSearchProvider, policy: ServiceAreaPolicy): WebSearchProvider {
  return { search: async query => {
    const result = await provider.search(query); if (!result.data) return result;
    const results = [];
    for (const hit of result.data.results) if (await policy.allowsSource(hit.title, [hit.description, ...(hit.extraSnippets ?? [])].filter(Boolean).join("\n"))) {
      results.push(hit); policy.approvedSourceUrls.add(hit.url);
    }
    return { ...result, data: { ...result.data, results } };
  } };
}
export function serviceAreaPages(reader: WebPageReader, policy: ServiceAreaPolicy): WebPageReader {
  return { search: async query => {
    const result = await reader.search(query); if (!result.data) return result;
    const pages = [];
    for (const page of result.data.pages) {
      if (explicitlyOutsideServiceArea(page.text)) continue;
      if (policy.approvedSourceUrls.has(page.url) || await policy.allowsSource(page.title ?? "", page.text)) pages.push(page);
    }
    return { ...result, data: { ...result.data, pages } };
  } };
}
export function serviceAreaKnowledge(retriever: TravelKnowledgeRetriever, policy: ServiceAreaPolicy): TravelKnowledgeRetriever {
  return { channel: retriever.channel, retrieve: async (query, request, limit, signal) => {
    const batch = await retriever.retrieve(query, request, limit, signal), hits = [];
    for (const hit of batch.hits) if (await policy.allowsSource(typeof hit.metadata.title === "string" ? hit.metadata.title : "", hit.text, hit.metadata)) hits.push(hit);
    return { ...batch, hits, coverage: { ...batch.coverage, omittedHits: batch.coverage.omittedHits + batch.hits.length - hits.length },
      incompleteReasons: [...batch.incompleteReasons, ...(hits.length < batch.hits.length ? ["service_area_filtered"] : [])] };
  } };
}
export const serviceAreaSearchScope = { policyVersion: serviceAreaPolicyVersion, prefectures: serviceAreaPrefectures };
