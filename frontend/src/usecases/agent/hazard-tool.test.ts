import { describe, expect, it, vi } from "vitest";
import { hazardAlert, hazardInformation } from "../../../../modules/trip/domain/hazard-alert.fixture";
import { executeExternalTravelTool, compactExternalTravelToolObservation, externalTravelEvidence, externalTravelToolDescription,
  externalTravelToolInputSchema, externalTravelToolNames, type ExternalTravelToolState } from "./external-travel-tools";

describe("public hazard tool boundary", () => {
  it("keeps the tool name, declares public facts and no implicit impact", () => {
    expect(externalTravelToolNames).toContain("search_travel_alerts");
    expect(externalTravelToolNames as readonly string[]).not.toContain("search_hazard_alerts");
    expect(externalTravelToolDescription("search_travel_alerts")).toContain("公的な気象・災害情報");
    expect(externalTravelToolDescription("search_travel_alerts")).toContain("旅行への具体的影響は未評価なら断定しない");
    expect(externalTravelToolInputSchema("search_travel_alerts").additionalProperties).toBe(false);
  });
  it("projects only bounded public facts and shared source metadata to the model", async () => {
    const alerts = hazardInformation(Array.from({ length: 12 }, (_, i) => hazardAlert({ providerAlertId: `id-${i}`, issuer: "公的機関",
      title: "題".repeat(160), summary: "情".repeat(600) })));
    const state: ExternalTravelToolState = {};
    const output = await executeExternalTravelTool("search_travel_alerts", { area: "大阪府", limit: 12 }, { searchHazardAlerts: async () => ({ alerts }) }, state);
    const projected = compactExternalTravelToolObservation("search_travel_alerts", output) as { alerts: { data: { area: string; alerts: unknown[] }; evidence: unknown[] } };
    expect(projected.alerts.data.area).toBe("大阪府");
    expect(Object.keys(projected.alerts.data.alerts[0] as object)).toEqual(["category", "severity", "title", "summary", "issuedAt"]);
    expect(projected.alerts.evidence).toEqual(alerts.evidence);
    expect(JSON.stringify(projected).length).toBeLessThan(12_000);
    expect(state.alerts?.data?.alerts[0]?.providerAlertId).toBe("id-0"); // identity retained outside model projection
    expect(externalTravelEvidence(output, { retrievedAt: "2026-09-12T08:00:00Z" })[0]?.references[0]?.sourceRef).toBe("https://example.com/public-warning");
  });
  it("rejects raw/mismatched provider results and does not leave prior-area state visible", async () => {
    for (const value of [{ alerts: { ...hazardInformation(), raw: "PRIVATE" } },
      { alerts: { ...hazardInformation(), data: { area: "島根県", alerts: [] } } }]) {
      const state: ExternalTravelToolState = { alerts: hazardInformation() };
      await expect(executeExternalTravelTool("search_travel_alerts", { area: "大阪府" }, { searchHazardAlerts: async () => value }, state)).rejects.toThrow();
      expect(state.alerts).toBeUndefined();
    }
    const provider = vi.fn();
    await expect(executeExternalTravelTool("search_travel_alerts", { area: "大阪府", categories: ["invalid"] }, { searchHazardAlerts: provider }, {})).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });
  it("failure is bounded and has no fake safe result", async () => {
    const alerts = { status: "unavailable", freshness: "unknown", evidence: [], failure: { code: "timeout", message: "未取得", retryable: true } };
    const state: ExternalTravelToolState = {};
    const result = await executeExternalTravelTool("search_travel_alerts", { area: "大阪府" }, { searchHazardAlerts: async () => ({ alerts }) }, state);
    expect(compactExternalTravelToolObservation("search_travel_alerts", result)).toEqual({ alerts: {
      status: "unavailable", freshness: "unknown", evidence: [], failure: { code: "timeout", retryable: true },
    } });
    expect(state.alerts?.status).toBe("unavailable");
  });
});
