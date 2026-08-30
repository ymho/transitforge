import type { JourneyRouteResult } from "@raiquora/journey/direct-route-search";
import type {
  JourneyRankingPreference,
  TransferPace,
} from "@raiquora/journey/journey-search-preferences";

export interface TripJourneyPlan {
  departureDate?: string;
  serviceDate?: string;
  originStation: string;
  destinationStation: string;
  transferPace?: TransferPace;
  rankingPreference?: JourneyRankingPreference;
  maxTransfers?: number;
  searchTimeMinutes?: number;
  excludedServiceTypes?: string[];
  excludedTrainNames?: string[];
  excludedTrainNumbers?: string[];
  excludedServiceUids?: string[];
  requiredServiceTypes?: string[];
  requiredTrainNames?: string[];
  requiredTrainNumbers?: string[];
  allowedServiceTypes?: string[];
  journeys: JourneyRouteResult[];
}

export interface TripAccommodation {
  provider?: string;
  providerItemId?: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  bookingUrl?: string;
  areaName?: string;
  imageUrl?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  reviewAverage?: number;
  reviewCount?: number;
  price?: {
    amount: number;
    currency: "JPY";
    basis: "reference-minimum" | "selected-dates";
  };
  availability?: "available" | "unknown";
}

export interface TravelPlan {
  destination: string;
  dayTrip?: boolean;
  adults?: number;
  children?: number;
  considerations?: string[];
  checkInDate: string;
  checkOutDate: string;
  outbound: TripJourneyPlan;
  returning: TripJourneyPlan;
  accommodations: TripAccommodation[];
}
