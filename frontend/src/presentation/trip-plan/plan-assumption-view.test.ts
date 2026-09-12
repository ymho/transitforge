import { describe, expect, it } from "vitest";
import { planAssumptionViews } from "./plan-assumption-view";
import { assumedRequest, requestTrip } from "../../../../modules/trip/domain/trip-request.fixture";

describe("assumption display projection", () => {
  it("labels provisional state, exposes explicit actions and does not render raw HTML", () => {
    const request = assumedRequest();
    const trip = requestTrip({ ...request, assumptions: request.assumptions.map((a) => ({ ...a, text: "<b>仮の出発地</b>" })) });
    const view = planAssumptionViews(trip)[0]!;
    expect(view.text).toBe("⚠ 仮置き: <b>仮の出発地</b>"); // Plain text; no HTML rendering method/markup field.
    expect(view).not.toHaveProperty("html");
    expect(view.actions.map((action) => action.status)).toEqual(["confirmed", "rejected"]);
    expect(trip.request.assumptions[0]!.status).toBe("unconfirmed");
  });
  it("does not advertise confirmation of not-yet-implemented party state", () => {
    const trip = requestTrip({ constraints: [], assumptions: [{ id: "party", text: "人数は仮置き", source: "legacy", status: "unconfirmed", affects: [{ type: "party" }] }] });
    expect(planAssumptionViews(trip)[0]!.actions.map((action) => action.status)).toEqual(["rejected"]);
  });
});
