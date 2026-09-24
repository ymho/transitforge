import type { ExternalTravelProviderPort } from "./external-travel-information";
import { samePlaceIdentity, type PlaceRef } from "./place-snapshot";

export interface PlaceMediaQuery {
  query: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  limit?: number;
  categories?: string[];
  availableFrom?: string;
  availableUntil?: string;
  detail?: boolean;
}

export interface PlaceMediaImage {
  url: string;
  width?: number;
  height?: number;
  creator?: string;
  license?: string;
  attribution: string;
  descriptionUrl?: string;
  displayUntil?: string;
  hotlinkAllowed: boolean | "unknown";
}

export interface PlaceEditorialDetail {
  overview?: string;
  highlights?: string[];
  atmosphere?: string;
  tips?: string[];
  nearby?: string[];
}

export type PlaceAdministrativeAreaKind =
  | "neighborhood"
  | "locality"
  | "place"
  | "district"
  | "region"
  | "country";

/** Provider-independent administrative hierarchy observed for a place. */
export interface PlaceAdministrativeArea {
  kind: PlaceAdministrativeAreaKind;
  name: string;
  providerPlaceId?: string;
}

export interface PlaceMedia {
  /** Matching a requested target, NOT the entity's own stable identity. Absent for discovery. */
  targetBinding?: { status: "resolved" | "unresolved" | "mismatch"; reason: "stable-id" | "different-id" | "missing-binding" | "source-binding" };
  providerPlaceId: string;
  name: string;
  categories?: string[];
  address?: string;
  administrativeAreas?: PlaceAdministrativeArea[];
  summary?: string;
  latitude?: number;
  longitude?: number;
  sourceUrl: string;
  /** Provider metadata or Web research has identified this as the venue's own site. */
  officialWebsiteUrl?: string;
  sources?: Array<{
    provider: string;
    label: string;
    url: string;
    role: "identity" | "description" | "discovery";
  }>;
  openingHours?: string;
  openingHoursStatus: "available" | "unknown";
  reviewAverage?: number;
  reviewCount?: number;
  detail?: PlaceEditorialDetail;
  image?: PlaceMediaImage;
  images?: PlaceMediaImage[];
}

export interface PlaceMediaSearchResult { places: PlaceMedia[] }

export type PlaceMediaProvider = ExternalTravelProviderPort<
  PlaceMediaQuery,
  PlaceMediaSearchResult
>;

export function mergePlaceMedia(places: readonly PlaceMedia[]): PlaceMedia[] {
  const merged = new Map<string, PlaceMedia>();
  for (const place of places) {
    const key = JSON.stringify([place.sources?.find((s) => s.role === "identity")?.provider ?? place.sourceUrl, place.providerPlaceId]);
    const current = merged.get(key);
    merged.set(key, current ? { ...current, ...place, categories: [...new Set([...(current.categories ?? []), ...(place.categories ?? [])])] } : { ...place });
  }
  return [...merged.values()];
}

/** Names and proximity are discovery hints, never proof of target identity. */
export function resolvePlaceTargetBinding(place: PlaceMedia, target?: PlaceRef): NonNullable<PlaceMedia["targetBinding"]> {
  const provider = place.sources?.find((s) => s.role === "identity")?.provider;
  if (!target || !provider || !place.providerPlaceId || target.provider !== provider || !target.providerPlaceId) {
    return { status: "unresolved", reason: "missing-binding" };
  }
  const same = samePlaceIdentity(target, { provider, providerPlaceId: place.providerPlaceId });
  return same ? { status: "resolved", reason: "stable-id" } : { status: "mismatch", reason: "different-id" };
}

export function placeMediaRef(place: PlaceMedia): PlaceRef | undefined {
  const provider = place.sources?.find(s => s.role === "identity")?.provider;
  return provider && place.providerPlaceId ? { provider, providerPlaceId: place.providerPlaceId } : undefined;
}

/** Source binding must be an exact facility page, not a host, article title or nearby point. */
export function samePlaceSourcePage(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  try {
    const a = new URL(left), b = new URL(right);
    return a.protocol === "https:" && b.protocol === "https:" && !a.username && !a.password && !b.username && !b.password &&
      !a.search && !b.search && !a.hash && !b.hash && a.pathname !== "/" && a.origin === b.origin && a.pathname === b.pathname;
  } catch { return false; }
}

export function samePlaceMediaEntity(left: PlaceMedia, right: PlaceMedia): boolean {
  const a = placeMediaRef(left), b = placeMediaRef(right);
  // Legacy records without namespaces cannot prove cross-response identity.
  return Boolean(a && b && samePlaceIdentity(a, b));
}

export function placeMediaQueryForTrip(input: { destination: string; interests?: string[]; availableFrom?: string; availableUntil?: string; limit?: number }): PlaceMediaQuery {
  return { query: input.destination, ...(input.interests?.length ? { categories: input.interests.slice(0, 8) } : {}), ...(input.availableFrom ? { availableFrom: input.availableFrom } : {}), ...(input.availableUntil ? { availableUntil: input.availableUntil } : {}), limit: Math.max(1, Math.min(8, input.limit ?? 5)) };
}
