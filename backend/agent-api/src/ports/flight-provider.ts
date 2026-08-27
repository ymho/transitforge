export type { FlightSearchProvider as FlightProvider } from "@raiquora/trip/flight-search";

export interface FlightProviderCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

export interface FlightProviderCredentialsRepository {
  load(): Promise<FlightProviderCredentials | undefined>;
}
