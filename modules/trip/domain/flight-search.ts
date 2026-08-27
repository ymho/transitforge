import type { ExternalTravelProviderPort } from "./external-travel-information";

export interface FlightSearchQuery {
  originAirportCode: string;
  destinationAirportCode: string;
  departureDate: string;
  adults?: number;
  nonStop?: boolean;
  limit?: number;
}
export interface FlightSegment { departureAirportCode: string; arrivalAirportCode: string; departureAt: string; arrivalAt: string; carrierCode: string; flightNumber: string }
export interface FlightOffer {
  providerOfferId: string;
  segments: FlightSegment[];
  nonStop: boolean;
  bookable: boolean | "unknown";
  remainingSeats?: number;
  price?: { amount: string; currency: string };
}
export interface FlightSearchResult { offers: FlightOffer[] }
export type FlightSearchProvider = ExternalTravelProviderPort<FlightSearchQuery, FlightSearchResult>;
