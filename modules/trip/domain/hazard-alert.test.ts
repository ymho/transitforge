import { describe, expect, it } from "vitest";
import { hazardAlert, hazardInformation } from "./hazard-alert.fixture";
import { hazardAlertCategories, hazardAlertSeverities, parseHazardAlertQuery, validateHazardAlert,
  validateHazardAlertInformation, validateHazardAlertSearchResult } from "./hazard-alert";

describe("HazardAlert public fact contract", () => {
  it("accepts every category/public severity without converting to impact severity", () => {
    for (const category of hazardAlertCategories) for (const severity of hazardAlertSeverities) {
      const alert = hazardAlert({ category, severity });
      expect(() => validateHazardAlert(alert)).not.toThrow();
      expect(alert.severity).toBe(severity);
    }
  });
  it.each([
    { providerAlertId: "" }, { providerAlertId: "x".repeat(301) }, { providerAlertId: "\nsecret" },
    { category: "rain" }, { severity: "critical" }, { severity: "action-required" },
    { title: " " }, { title: "x".repeat(161) }, { summary: "" }, { summary: "x".repeat(601) },
    { issuer: "x".repeat(121) }, { issuedAt: "2026-02-30T10:00:00Z" }, { issuedAt: "2026-09-12" },
    { sourceUrl: "http://example.com" }, { sourceUrl: "javascript:alert(1)" }, { sourceUrl: "https://secret@example.com" },
    { sourceUrl: "https://example.com/?token=secret" }, { sourceUrl: "https://example.com/#secret" },
    { raw: {} }, { sent: true }, { read: true }, { notifiedAt: "2026-09-12T10:00:00Z" },
    { notificationId: "id" }, { deliveryStatus: "sent" }, { suppressed: true },
  ])("rejects invalid or foreign responsibility fields %j", (extra) => {
    expect(() => validateHazardAlert({ ...hazardAlert(), ...extra })).toThrow();
  });
  it("accepts exact bounds and does not rewrite opaque IDs or input", () => {
    const alert = hazardAlert({ providerAlertId: "Ａ".repeat(300), title: "x".repeat(160), summary: "x".repeat(600), issuer: "x".repeat(120) });
    const before = JSON.stringify(alert);
    validateHazardAlert(alert);
    expect(JSON.stringify(alert)).toBe(before);
  });
  it("retains area/evidence/freshness, including empty observations and unavailable", () => {
    for (const information of [hazardInformation(), hazardInformation([]), { status: "unknown", freshness: "unknown", evidence: [] },
      { status: "unavailable", freshness: "unknown", evidence: [], failure: { code: "timeout", message: "未取得", retryable: true } }]) {
      const before = JSON.stringify(information);
      validateHazardAlertInformation(information);
      expect(JSON.stringify(information)).toBe(before);
    }
    for (const invalid of [{ area: "", alerts: [] }, { area: "x".repeat(81), alerts: [] },
      { area: "大阪府", alerts: Array(13).fill(hazardAlert()) }, { area: "大阪府", alerts: [], impactedItemIds: [] }]) {
      expect(() => validateHazardAlertSearchResult(invalid)).toThrow();
    }
  });
  it("rejects raw envelope/source, missing evidence, malformed availability and unsafe Evidence", () => {
    const base = hazardInformation();
    for (const value of [{ ...base, raw: "XML" }, { ...base, evidence: [] }, { ...base, status: "unknown" },
      { ...base, data: undefined }, { ...base, failure: { code: "unavailable", message: "failed", retryable: true } },
      { ...base, evidence: Array(25).fill(base.evidence[0]) }, { ...base, evidence: [base.evidence[0], base.evidence[0]] },
      ...[{ kind: "web" }, { retrievedAt: "yesterday" }, { sourceUrl: "https://example.com/?key=secret" }, { raw: "XML" }, { attribution: "x".repeat(241) }]
        .map((patch) => ({ ...base, evidence: [{ ...base.evidence[0], ...patch }] }))]) {
      expect(() => validateHazardAlertInformation(value)).toThrow();
    }
  });
});

describe("HazardAlert query", () => {
  it("normalizes only the user search area and preserves selected categories/limit", () => {
    const query = { area: " 大阪府 ", categories: [...hazardAlertCategories], limit: 12 };
    expect(parseHazardAlertQuery(query)).toEqual({ ...query, area: "大阪府" });
    expect(query.area).toBe(" 大阪府 ");
    expect(parseHazardAlertQuery({ area: "大阪府", categories: [], limit: 1 }).limit).toBe(1);
  });
  it.each([null, [], {}, { area: " " }, { area: "x".repeat(81) }, { area: "大阪\n府" },
    ...[0, 13, 1.5, NaN, Infinity, "2"].map((limit) => ({ area: "大阪府", limit })),
    ...["warning", ["bad"], ["warning", "warning"], [null]].map((categories) => ({ area: "大阪府", categories })),
    { area: "大阪府", tripId: "no-authority" }])("rejects invalid query %j", (value) => {
    expect(() => parseHazardAlertQuery(value)).toThrow();
  });
});
