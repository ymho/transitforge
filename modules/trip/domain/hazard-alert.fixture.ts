import type { HazardAlert, HazardAlertSearchResult } from "./hazard-alert";
import type { ExternalTravelInformation } from "./external-travel-information";

/** Synthetic public facts only. No downloaded JMA document. */
export function hazardAlert(overrides: Partial<HazardAlert> = {}): HazardAlert {
  return { providerAlertId: "synthetic-warning:Ａ", category: "warning", severity: "warning", title: "試験用警報",
    summary: "大阪府の試験用の公的発表。旅行への影響は未評価。", issuedAt: "2026-09-12T07:50:00Z",
    sourceUrl: "https://example.com/public-warning", ...overrides };
}
export function hazardInformation(alerts: HazardAlert[] = [hazardAlert()]): ExternalTravelInformation<HazardAlertSearchResult> {
  return { status: "available", freshness: "fresh", data: { area: "大阪府", alerts }, evidence: [{
    id: "hazard-source", kind: "safety-alert", provider: "synthetic-public-provider", sourceUrl: "https://example.com/public-warning",
    retrievedAt: "2026-09-12T08:00:00Z", validUntil: "2026-09-12T08:05:00Z", confidence: "observed",
  }] };
}
