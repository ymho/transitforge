import type { ExternalTravelProviderPort } from "./external-travel-information";

export type WebSearchFreshness = "day" | "week" | "month" | "year";

export interface WebSearchQuery {
  query: string;
  limit?: number;
  freshness?: WebSearchFreshness;
  domains?: string[];
}

export interface WebSearchHit {
  id: string;
  title: string;
  url: string;
  description?: string;
  extraSnippets?: string[];
  publishedAt?: string;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchHit[];
}

export interface WebPageReadQuery {
  urls: string[];
}

export interface WebPageDocument {
  url: string;
  title?: string;
  publisher?: string;
  text: string;
  contentType: "html" | "text";
  truncated: boolean;
  untrustedExternalContent: true;
}

export interface WebPageReadResult {
  pages: WebPageDocument[];
}

export type WebSearchProvider = ExternalTravelProviderPort<WebSearchQuery, WebSearchResult>;
export type WebPageReader = ExternalTravelProviderPort<WebPageReadQuery, WebPageReadResult>;
