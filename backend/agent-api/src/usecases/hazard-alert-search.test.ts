import { describe, expect, it, vi } from "vitest";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import { createHazardAlertSearchOperation } from "./hazard-alert-search.js";
import { hazardInformation } from "../../../../modules/trip/domain/hazard-alert.fixture";
import { validateHazardAlertInformation } from "@raiquora/trip/hazard-alert";

describe("createHazardAlertSearchOperation", () => {
  it("検証した地域とカテゴリだけをProviderへ渡す", async () => {
    const search = vi.fn(async () => availableExternalInformation({ area: "島根県", alerts: [] }, []));
    const operation = createHazardAlertSearchOperation({ search });
    const response = await operation({ area: " 島根県 ", categories: ["warning"], limit: 5 }, { requestId: "test" });
    expect(search).toHaveBeenCalledWith({ area: "島根県", categories: ["warning"], limit: 5 });
    expect(response.body).toHaveProperty("alerts.status", "available");
  });

  it("空の地域を拒否する", async () => {
    const operation = createHazardAlertSearchOperation({ search: vi.fn() });
    expect((await operation({ area: "" }, { requestId: "test" })).statusCode).toBe(400);
  });
  it.each([{ area: "大阪府", categories: ["invalid"] }, { area: "大阪府", limit: "3" },
    { area: "大阪府", limit: 13 }, { area: "大阪府", limit: 1.5 }, { area: "大阪府", raw: "no" }])("不正条件を黙って変更しない", async (query) => {
    const search = vi.fn();
    expect((await createHazardAlertSearchOperation({ search })(query, { requestId: "test" })).statusCode).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });
  it("既存operation/alerts wireを維持し、JSON round tripでも検証できる", async () => {
    const alerts = hazardInformation();
    const response = await createHazardAlertSearchOperation({ search: async () => alerts })(
      { operation: "travel_alert_search", area: "大阪府" }, { requestId: "test" });
    const parsed = JSON.parse(JSON.stringify(response.body));
    expect(Object.keys(parsed)).toEqual(["alerts"]);
    validateHazardAlertInformation(parsed.alerts);
    expect(parsed.alerts).toEqual(alerts);
  });
  it("providerの未知field/範囲違いはinvalid_responseであり生データを返さない", async () => {
    for (const alerts of [{ ...hazardInformation(), raw: "PRIVATE" },
      { ...hazardInformation(), data: { area: "島根県", alerts: [] } }]) {
      const response = await createHazardAlertSearchOperation({ search: async () => alerts })({ area: "大阪府" }, { requestId: "test" });
      expect(response.body).toMatchObject({ alerts: { status: "unavailable", failure: { code: "invalid_response" } } });
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE");
    }
  });
  it("unknown/unavailableはそのまま返し、例外はunavailableへ正規化する", async () => {
    for (const status of ["unknown", "unavailable"] as const) {
      const alerts = { status, freshness: "unknown" as const, evidence: [] };
      expect((await createHazardAlertSearchOperation({ search: async () => alerts })({ area: "大阪府" }, { requestId: "test" })).body.alerts).toEqual(alerts);
    }
    const response = await createHazardAlertSearchOperation({ search: async () => { throw new Error("PRIVATE"); } })({ area: "大阪府" }, { requestId: "test" });
    expect(response.body).toMatchObject({ alerts: { status: "unavailable" } });
    expect(JSON.stringify(response)).not.toContain("PRIVATE");
  });
});
