import { expect, it, vi } from "vitest";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import { ServiceAreaPolicy, serviceAreaPlaces, serviceAreaRestaurants, serviceAreaAccommodations, serviceAreaWebSearch, serviceAreaPages, serviceAreaKnowledge } from "./service-area.js";

const observedAt = new Date("2026-10-11T00:00:00Z");
const available = <T>(data: T) => availableExternalInformation(data, [], observedAt);
const lookup = { resolve: vi.fn(async () => undefined) };

it("filters outside and unresolved place results, including a coordinate-only fallback", async () => {
  const resolve = vi.fn(async () => ({ country: "JP", prefecture: "宮城県" }));
  const policy = new ServiceAreaPolicy({ resolve });
  const places = await serviceAreaPlaces({ search: async () => available({ places: [
    { providerPlaceId: "1", name: "出雲大社", address: "島根県出雲市", sourceUrl: "https://example.org/1", openingHoursStatus: "unknown" as const },
    { providerPlaceId: "2", name: "仙台の観光地", latitude: 38.26, longitude: 140.87, sourceUrl: "https://example.org/2", openingHoursStatus: "unknown" as const },
  ] }) }, policy).search({ query: "神社" });
  expect(places.data?.places.map(place => place.name)).toEqual(["出雲大社"]);
  expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ latitude: 38.26 }));
  expect(await policy.classify({ address: "京都府京都市", administrativeAreas: [{ kind: "country", name: "United States" }] })).toBe("outside");
  expect(await new ServiceAreaPolicy(lookup).classify({ name: "不明な場所" })).toBe("unresolved");
});

it("filters hotels and restaurants independently from the query area", async () => {
  const policy = new ServiceAreaPolicy(lookup);
  const hotel = { kind: "accommodation" as const, provider: "fixture", checkInDate: "2026-10-11", checkOutDate: "2026-10-12" };
  const hotels = await serviceAreaAccommodations({ search: async () => [
    { ...hotel, providerItemId: "1", name: "京都", address: "京都府京都市" },
    { ...hotel, providerItemId: "2", name: "仙台", address: "宮城県仙台市" },
    { ...hotel, providerItemId: "3", name: "不明" },
  ] }, policy).search({ destination: "京都", checkInDate: "2026-10-11", checkOutDate: "2026-10-12", adults: 1, limit: 6 });
  expect(hotels.map(place => place.providerItemId)).toEqual(["1"]);
  const restaurants = await serviceAreaRestaurants({ search: async () => available({ area: "京都", restaurants: [
    { providerRestaurantId: "1", name: "対象", address: "京都府京都市", detailUrl: "https://example.org/1" },
    { providerRestaurantId: "2", name: "対象外", address: "沖縄県那覇市", detailUrl: "https://example.org/2" },
  ] }) }, policy).search({ area: "京都" });
  expect(restaurants.data?.restaurants.map(place => place.providerRestaurantId)).toEqual(["1"]);
});

it("filters web leads, explicit page reads and mixed-prefecture KB documents", async () => {
  const policy = new ServiceAreaPolicy(lookup);
  const search = await serviceAreaWebSearch({ search: async () => available({ query: "神社", results: [
    { id: "1", title: "出雲大社", url: "https://example.org/1", description: "島根県出雲市" },
    { id: "2", title: "仙台", url: "https://example.org/2", description: "宮城県仙台市" },
  ] }) }, policy).search({ query: "神社" });
  expect(search.data?.results.map(hit => hit.id)).toEqual(["1"]);
  const pages = await serviceAreaPages({ search: async () => available({ pages: [
    { url: "https://example.org/1", text: "拝観情報", contentType: "html" as const, truncated: false, untrustedExternalContent: true as const },
    { url: "https://example.org/2", title: "仙台", text: "宮城県仙台市", contentType: "html" as const, truncated: false, untrustedExternalContent: true as const },
  ] }) }, policy).search({ urls: ["https://example.org/1", "https://example.org/2"] });
  expect(pages.data?.pages.map(page => page.url)).toEqual(["https://example.org/1"]);
  expect(await policy.allowsSource("記事", "", { prefectures: ["京都府", "青森県"] })).toBe(false);
  expect(await policy.allowsSource("混在資料", "青森県の観光地", { prefectures: ["京都府"] })).toBe(false);
  const batch = await serviceAreaKnowledge({ channel: "knowledge_base", retrieve: async () => ({ hits: [
    { hitId: "kb1", sourceRef: "https://example.org/kb", text: "料理", metadata: { prefectures: ["青森県"] }, retrievedAt: observedAt.toISOString(), originalRank: 1, retention: "bounded_excerpt", retrievalChannel: "knowledge_base" },
  ], coverage: { attemptedFacetKinds: [], channels: ["knowledge_base"], requestedQueries: 1, completedQueries: 1, omittedHits: 0 }, incompleteReasons: [] }) }, policy)
    .retrieve("料理", { requestRef: "r", facets: [{ kind: "activity", value: "料理" }], explicitFilters: [], unresolvedFilters: [], scopeRef: "s", budgetRef: "b" }, 6);
  expect(batch.hits).toEqual([]); expect(batch.incompleteReasons).toContain("service_area_filtered");
});
