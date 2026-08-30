import { describe, expect, it, vi } from "vitest";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import { createTravelAlertSearchOperation } from "./travel-alert-search.js";

describe("createTravelAlertSearchOperation", () => {
  it("検証した地域とカテゴリだけをProviderへ渡す", async () => {
    const search = vi.fn(async () => availableExternalInformation({ area: "島根県", alerts: [] }, []));
    const operation = createTravelAlertSearchOperation({ search });
    const response = await operation({ area: " 島根県 ", categories: ["warning", "invalid"], limit: 5 }, { requestId: "test" });
    expect(search).toHaveBeenCalledWith({ area: "島根県", categories: ["warning"], limit: 5 });
    expect(response.body).toHaveProperty("alerts.status", "available");
  });

  it("空の地域を拒否する", async () => {
    const operation = createTravelAlertSearchOperation({ search: vi.fn() });
    expect((await operation({ area: "" }, { requestId: "test" })).statusCode).toBe(400);
  });
});
