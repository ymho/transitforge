import type { ExternalTravelProviderPort } from "./external-travel-information";

export interface PlaceMediaQuery {
  query: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  limit?: number;
  categories?: string[];
  availableFrom?: string;
  availableUntil?: string;
}

export interface PlaceMedia {
  providerPlaceId: string;
  name: string;
  categories?: string[];
  address?: string;
  summary?: string;
  latitude?: number;
  longitude?: number;
  sourceUrl: string;
  sources?: Array<{
    provider: string;
    label: string;
    url: string;
    role: "identity" | "description" | "discovery";
  }>;
  openingHours?: string;
  openingHoursStatus: "available" | "unknown";
  image?: {
    url: string;
    width?: number;
    height?: number;
    creator?: string;
    license?: string;
    attribution: string;
    descriptionUrl?: string;
    displayUntil?: string;
    hotlinkAllowed: boolean | "unknown";
  };
}

export interface PlaceMediaSearchResult { places: PlaceMedia[] }

export type PlaceMediaProvider = ExternalTravelProviderPort<
  PlaceMediaQuery,
  PlaceMediaSearchResult
>;

export function mergePlaceMedia(places: readonly PlaceMedia[]): PlaceMedia[] {
  const merged = new Map<string, PlaceMedia>();
  for (const place of places) {
    const coordinateKey = place.latitude === undefined || place.longitude === undefined ? "" : `:${place.latitude.toFixed(4)}:${place.longitude.toFixed(4)}`;
    const key = `${place.providerPlaceId}${coordinateKey}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, ...place, categories: [...new Set([...(current.categories ?? []), ...(place.categories ?? [])])] } : { ...place });
  }
  return [...merged.values()];
}

export function placeMediaQueryForTrip(input: { destination: string; interests?: string[]; availableFrom?: string; availableUntil?: string; limit?: number }): PlaceMediaQuery {
  return { query: input.destination, ...(input.interests?.length ? { categories: input.interests.slice(0, 8) } : {}), ...(input.availableFrom ? { availableFrom: input.availableFrom } : {}), ...(input.availableUntil ? { availableUntil: input.availableUntil } : {}), limit: Math.max(1, Math.min(8, input.limit ?? 5)) };
}
