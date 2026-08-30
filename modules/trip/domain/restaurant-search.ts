import type { ExternalTravelProviderPort } from "./external-travel-information";

export interface RestaurantSearchQuery {
  area: string;
  keyword?: string;
  latitude?: number;
  longitude?: number;
  range?: 1 | 2 | 3 | 4 | 5;
  requirements?: RestaurantRequirements;
  limit?: number;
}
export interface RestaurantRequirements {
  lunch?: boolean;
  lateNight?: boolean;
  childFriendly?: boolean;
  nonSmoking?: boolean;
  barrierFree?: boolean;
  parking?: boolean;
  privateRoom?: boolean;
  cardAccepted?: boolean;
}
export interface RestaurantCandidate {
  providerRestaurantId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  genre?: string;
  budget?: string;
  averageBudget?: string;
  openingHours?: string;
  regularHoliday?: string;
  stationName?: string;
  access?: string;
  features?: string[];
  imageUrl?: string;
  detailUrl: string;
  mapboxPlaceId?: string;
}
export interface RestaurantSearchResult { area: string; restaurants: RestaurantCandidate[] }
export type RestaurantProvider = ExternalTravelProviderPort<RestaurantSearchQuery, RestaurantSearchResult>;
