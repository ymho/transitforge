import { describe, expect, it, vi } from "vitest";
import { hazardInformation } from "../../../../../modules/trip/domain/hazard-alert.fixture";
import { isHazardAlertSearchResponse } from "./bedrock-agent-validation";
import { searchHazardAlerts } from "./bedrock-agent";

describe("Hazard internal naming / travel_alert_search wire compatibility", () => {
  it("keeps operation and response fields unchanged", async () => {
    const body = { alerts: hazardInformation() };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    const response = await searchHazardAlerts({ area: "大阪府", categories: ["warning"], limit: 2 }, fetcher);
    expect(response).toEqual(body);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ operation: "travel_alert_search", area: "大阪府", categories: ["warning"], limit: 2 });
  });
  it("uses the shared Domain validator for fields, bounds, URL and evidence", () => {
    const good = hazardInformation();
    expect(isHazardAlertSearchResponse({ alerts: good })).toBe(true);
    for (const invalid of [{ alerts: good, raw: "secret" }, { alerts: { ...good, raw: "secret" } },
      ...[{ sourceUrl: "https://example.com/?token=secret" }, { summary: "x".repeat(601) }, { issuedAt: "yesterday" }, { notifiedAt: "now" }, { severity: "critical" }]
        .map((extra) => ({ alerts: { ...good, data: { ...good.data, alerts: [{ ...good.data!.alerts[0], ...extra }] } } })),
      { alerts: { ...good, evidence: [{ ...good.evidence[0], raw: "secret" }] } }]) {
      expect(isHazardAlertSearchResponse(invalid)).toBe(false);
    }
    for (const status of ["unknown", "unavailable"]) {
      expect(isHazardAlertSearchResponse({ alerts: { status, freshness: "unknown", evidence: [] } })).toBe(true);
    }
  });
});
