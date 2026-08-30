import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import type { TravelProviderSearch } from "@raiquora/trip/travel-provider";

export interface AccommodationProvider {
  search(request: TravelProviderSearch, requestId?: string): Promise<readonly AccommodationOffering[]>;
}

export interface TravelProviderCredentials {
  applicationId: string;
  accessKey: string;
  hotelSearchUrl: string;
  vacantHotelSearchUrl?: string;
  affiliateId?: string;
}

export interface TravelProviderCredentialsRepository {
  load(): Promise<TravelProviderCredentials>;
}
