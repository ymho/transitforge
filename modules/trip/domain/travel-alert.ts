import type { ExternalTravelProviderPort } from "./external-travel-information";

export type TravelAlertCategory =
  | "warning"
  | "weather-information"
  | "typhoon"
  | "earthquake"
  | "tsunami"
  | "volcano"
  | "other";

export type TravelAlertSeverity = "information" | "advisory" | "warning" | "emergency" | "unknown";

export interface TravelAlertQuery {
  area: string;
  categories?: TravelAlertCategory[];
  limit?: number;
}

export interface TravelAlert {
  providerAlertId: string;
  category: TravelAlertCategory;
  severity: TravelAlertSeverity;
  title: string;
  summary: string;
  issuedAt: string;
  issuer?: string;
  sourceUrl: string;
}

export interface TravelAlertSearchResult {
  area: string;
  alerts: TravelAlert[];
}

export type TravelAlertProvider = ExternalTravelProviderPort<TravelAlertQuery, TravelAlertSearchResult>;
