import type { PlaceMedia } from "@raiquora/trip/place-media";
import type { RestaurantCandidate } from "@raiquora/trip/restaurant-search";
import type { TripAccommodation } from "@raiquora/trip/travel-plan";

interface MapTravelCandidateBase {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  imageUrl?: string;
  address?: string;
  summary?: string;
  categories?: string[];
  sourceUrl?: string;
}

export interface MapPlaceCandidate extends MapTravelCandidateBase {
  kind: "place";
  value: PlaceMedia;
}

export interface MapAccommodationCandidate extends MapTravelCandidateBase {
  kind: "accommodation";
  value: TripAccommodation;
  reviewAverage?: number;
  reviewCount?: number;
  priceLabel?: string;
  availabilityLabel?: string;
}

export interface MapRestaurantCandidate extends MapTravelCandidateBase {
  kind: "restaurant";
  value: RestaurantCandidate;
  openingHours?: string;
  budget?: string;
}

export type MapTravelCandidate =
  | MapPlaceCandidate
  | MapAccommodationCandidate
  | MapRestaurantCandidate;

export function mapPlaceCandidates(places: readonly PlaceMedia[]): MapPlaceCandidate[] {
  return places.flatMap((place) => {
    if (!isCoordinate(place.latitude, -90, 90) || !isCoordinate(place.longitude, -180, 180)) return [];
    return [{
      kind: "place",
      id: place.providerPlaceId,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      ...(place.image?.hotlinkAllowed === true ? { imageUrl: place.image.url } : {}),
      ...(place.address ? { address: place.address } : {}),
      ...(place.summary ? { summary: place.summary } : {}),
      ...(place.categories ? { categories: place.categories } : {}),
      sourceUrl: place.sourceUrl,
      value: place,
    }];
  });
}

export function mapAccommodationCandidates(
  accommodations: readonly TripAccommodation[],
): MapAccommodationCandidate[] {
  return accommodations.flatMap((accommodation, index) => {
    if (!isCoordinate(accommodation.latitude, -90, 90) ||
      !isCoordinate(accommodation.longitude, -180, 180)) return [];
    const id = accommodation.providerItemId ?? `accommodation-${index}-${accommodation.name}`;
    return [{
      kind: "accommodation",
      id,
      name: accommodation.name,
      latitude: accommodation.latitude,
      longitude: accommodation.longitude,
      ...(accommodation.imageUrl ? { imageUrl: accommodation.imageUrl } : {}),
      ...(accommodation.address || accommodation.areaName
        ? { address: accommodation.address ?? accommodation.areaName }
        : {}),
      categories: ["宿泊"],
      ...(accommodation.bookingUrl ? { sourceUrl: accommodation.bookingUrl } : {}),
      ...(accommodation.reviewAverage !== undefined ? { reviewAverage: accommodation.reviewAverage } : {}),
      ...(accommodation.reviewCount !== undefined ? { reviewCount: accommodation.reviewCount } : {}),
      ...(accommodation.price
        ? { priceLabel: `${accommodation.price.basis === "selected-dates" ? "日程内 1泊最安目安" : "1泊参考最安"} ${accommodation.price.amount.toLocaleString("ja-JP")}円` }
        : {}),
      availabilityLabel: accommodation.availability === "available" ? "空室あり" : "空室未確認",
      value: accommodation,
    }];
  });
}

export function mapRestaurantCandidates(
  restaurants: readonly RestaurantCandidate[],
): MapRestaurantCandidate[] {
  return restaurants.flatMap((restaurant) => {
    if (!isCoordinate(restaurant.latitude, -90, 90) ||
      !isCoordinate(restaurant.longitude, -180, 180)) return [];
    return [{
      kind: "restaurant",
      id: restaurant.providerRestaurantId,
      name: restaurant.name,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      ...(restaurant.imageUrl ? { imageUrl: restaurant.imageUrl } : {}),
      ...(restaurant.address ? { address: restaurant.address } : {}),
      ...(restaurant.genre ? { categories: [restaurant.genre] } : {}),
      sourceUrl: restaurant.detailUrl,
      ...(restaurant.openingHours ? { openingHours: restaurant.openingHours } : {}),
      ...(restaurant.averageBudget || restaurant.budget
        ? { budget: restaurant.averageBudget ?? restaurant.budget }
        : {}),
      value: restaurant,
    }];
  });
}

export function mapCandidateAsPlaceMedia(candidate: MapTravelCandidate): PlaceMedia {
  if (candidate.kind === "place") return candidate.value;
  return {
    providerPlaceId: candidate.id,
    name: candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    sourceUrl: candidate.sourceUrl ?? "https://example.invalid/",
    openingHoursStatus: "unknown",
    ...(candidate.address ? { address: candidate.address } : {}),
    ...(candidate.summary ? { summary: candidate.summary } : {}),
    ...(candidate.categories ? { categories: candidate.categories } : {}),
  };
}

function isCoordinate(value: number | undefined, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
