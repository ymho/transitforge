export type ExternalTravelInformationKind =
  | "weather"
  | "flight"
  | "place"
  | "media"
  | "accommodation"
  | "event";

export type ExternalInformationStatus = "available" | "unavailable" | "unknown";
export type ExternalInformationFreshness = "fresh" | "stale" | "unknown";

export interface ExternalSourceEvidence {
  id: string;
  kind: ExternalTravelInformationKind;
  provider: string;
  sourceId?: string;
  sourceUrl?: string;
  retrievedAt: string;
  observedAt?: string;
  validFrom?: string;
  validUntil?: string;
  attribution?: string;
  confidence: "observed" | "provider-forecast" | "provider-schedule" | "unknown";
}

export interface ExternalProviderFailure {
  code: "invalid_request" | "unauthorized" | "rate_limited" | "timeout" | "unavailable" | "invalid_response";
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export interface ExternalTravelInformation<T> {
  status: ExternalInformationStatus;
  freshness: ExternalInformationFreshness;
  data?: T;
  evidence: ExternalSourceEvidence[];
  failure?: ExternalProviderFailure;
}

export interface ExternalTravelProviderPort<Query, Result> {
  search(query: Query): Promise<ExternalTravelInformation<Result>>;
}

export function externalInformationFreshness(
  evidence: ExternalSourceEvidence[],
  now = new Date(),
): ExternalInformationFreshness {
  if (evidence.length === 0) return "unknown";
  let hasKnownValidity = false;
  for (const item of evidence) {
    const retrievedAt = instant(item.retrievedAt);
    const validFrom = item.validFrom ? instant(item.validFrom) : undefined;
    const validUntil = item.validUntil ? instant(item.validUntil) : undefined;
    if (retrievedAt === undefined || validFrom === null || validUntil === null) return "unknown";
    if (validFrom !== undefined || validUntil !== undefined) hasKnownValidity = true;
    if (validFrom !== undefined && now.getTime() < validFrom) return "stale";
    if (validUntil !== undefined && now.getTime() > validUntil) return "stale";
  }
  return hasKnownValidity ? "fresh" : "unknown";
}

export function availableExternalInformation<T>(
  data: T,
  evidence: ExternalSourceEvidence[],
  now = new Date(),
): ExternalTravelInformation<T> {
  return {
    status: "available",
    freshness: externalInformationFreshness(evidence, now),
    data,
    evidence: evidence.slice(0, 24),
  };
}

export function failedExternalInformation<T>(
  failure: ExternalProviderFailure,
  evidence: ExternalSourceEvidence[] = [],
): ExternalTravelInformation<T> {
  return {
    status: failure.code === "invalid_request" ? "unknown" : "unavailable",
    freshness: "unknown",
    evidence: evidence.slice(0, 24),
    failure: {
      ...failure,
      message: failure.message.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 240),
    },
  };
}

function instant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
