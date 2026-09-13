import { validateExternalSourceEvidence, type ExternalTravelInformation, type ExternalTravelProviderPort } from "./external-travel-information";
import { exactKeys, validInstant } from "./snapshot-validation";

export const hazardAlertCategories = ["warning", "weather-information", "typhoon", "earthquake", "tsunami", "volcano", "other"] as const;
export type HazardAlertCategory = typeof hazardAlertCategories[number];

/** Public hazard classification, NOT TripImpact or Notification severity. */
export const hazardAlertSeverities = ["information", "advisory", "warning", "emergency", "unknown"] as const;
export type HazardAlertSeverity = typeof hazardAlertSeverities[number];

export const hazardAlertBounds = { area: 80, id: 300, title: 160, summary: 600, issuer: 120, url: 500, alerts: 12, evidence: 24 } as const;

export interface HazardAlertQuery {
  area: string;
  categories?: HazardAlertCategory[];
  limit?: number;
}

export interface HazardAlert {
  providerAlertId: string;
  category: HazardAlertCategory;
  severity: HazardAlertSeverity;
  title: string;
  summary: string;
  issuedAt: string;
  issuer?: string;
  sourceUrl: string;
}

export interface HazardAlertSearchResult {
  /** Search scope only. Text matching does not prove a Trip item is affected. */
  area: string;
  alerts: HazardAlert[];
}

export type HazardAlertProvider = ExternalTravelProviderPort<HazardAlertQuery, HazardAlertSearchResult>;

function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  exactKeys(value as object, keys);
}
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}
function safeSourceUrl(value: unknown): boolean {
  if (!boundedText(value, hazardAlertBounds.url)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** Shared input boundary: never silently drop unknown categories or clamp invalid limits. */
export function parseHazardAlertQuery(value: unknown): HazardAlertQuery {
  record(value, ["area", "categories", "limit"]);
  const area = typeof value.area === "string" ? value.area.normalize("NFKC").trim() : "";
  if (!boundedText(area, hazardAlertBounds.area) || value.limit !== undefined &&
      (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > hazardAlertBounds.alerts)) throw new Error("Invalid hazard query");
  if (value.categories !== undefined && (!Array.isArray(value.categories) || value.categories.length > hazardAlertCategories.length ||
      new Set(value.categories).size !== value.categories.length || !value.categories.every((category) => hazardAlertCategories.includes(category)))) throw new Error("Invalid hazard categories");
  return { area, ...(value.categories === undefined ? {} : { categories: [...value.categories as HazardAlertCategory[]] }),
    ...(value.limit === undefined ? {} : { limit: value.limit as number }) };
}

export function validateHazardAlert(value: unknown): asserts value is HazardAlert {
  record(value, ["providerAlertId", "category", "severity", "title", "summary", "issuedAt", "issuer", "sourceUrl"]);
  if (!boundedText(value.providerAlertId, hazardAlertBounds.id) ||
      !hazardAlertCategories.includes(value.category as HazardAlertCategory) || !hazardAlertSeverities.includes(value.severity as HazardAlertSeverity) ||
      !boundedText(value.title, hazardAlertBounds.title) || !boundedText(value.summary, hazardAlertBounds.summary) ||
      !boundedText(value.issuedAt, 64) || !validInstant(value.issuedAt) ||
      value.issuer !== undefined && !boundedText(value.issuer, hazardAlertBounds.issuer) || !safeSourceUrl(value.sourceUrl)) throw new Error("Invalid public hazard fact");
}

export function validateHazardAlertSearchResult(value: unknown): asserts value is HazardAlertSearchResult {
  record(value, ["area", "alerts"]);
  if (!boundedText(value.area, hazardAlertBounds.area) || !Array.isArray(value.alerts) || value.alerts.length > hazardAlertBounds.alerts) throw new Error("Invalid hazard result");
  value.alerts.forEach(validateHazardAlert);
}

/** Same ExternalTravelInformation/Evidence contract, validated at every external boundary. */
export function validateHazardAlertInformation(value: unknown): asserts value is ExternalTravelInformation<HazardAlertSearchResult> {
  record(value, ["status", "freshness", "data", "evidence", "failure"]);
  if (!["available", "unavailable", "unknown"].includes(value.status as string) ||
      !["fresh", "stale", "unknown"].includes(value.freshness as string) || !Array.isArray(value.evidence) || value.evidence.length > hazardAlertBounds.evidence) throw new Error("Invalid hazard information");
  for (const source of value.evidence) {
    validateExternalSourceEvidence(source);
    if (source.kind !== "safety-alert" || !boundedText(source.id, 500) || !boundedText(source.provider, 80) ||
        source.sourceId !== undefined && !boundedText(source.sourceId, 500) ||
        source.sourceUrl !== undefined && !safeSourceUrl(source.sourceUrl) ||
        source.attribution !== undefined && !boundedText(source.attribution, 240)) throw new Error("Invalid hazard evidence");
    for (const at of [source.retrievedAt, source.observedAt, source.validFrom, source.validUntil]) {
      if (at !== undefined && !boundedText(at, 64)) throw new Error("Unbounded source time");
    }
  }
  if (new Set(value.evidence.map((source) => source.id)).size !== value.evidence.length) throw new Error("Duplicate hazard evidence");
  if (value.status === "available") {
    if (value.failure !== undefined) throw new Error("Conflicting hazard result");
    validateHazardAlertSearchResult(value.data);
    if (value.data.alerts.length && !value.evidence.length) throw new Error("Missing hazard evidence");
  } else if (value.data !== undefined) throw new Error("Unavailable hazard data");
  if (value.failure !== undefined) {
    record(value.failure, ["code", "message", "retryable", "retryAfterSeconds"]);
    const failure = value.failure;
    if (!["invalid_request", "unauthorized", "rate_limited", "timeout", "unavailable", "invalid_response"].includes(failure.code as string) ||
        !boundedText(failure.message, 240) || typeof failure.retryable !== "boolean" || failure.retryAfterSeconds !== undefined &&
        (typeof failure.retryAfterSeconds !== "number" || !Number.isFinite(failure.retryAfterSeconds) || failure.retryAfterSeconds < 0)) throw new Error("Invalid hazard failure");
  }
}
