import { expect, it } from "vitest";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { conditionFields } from "./condition-fields";
import { editTripConstraint } from "../../usecases/trip-plan/edit-trip-conditions";
const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-19T00:00:00Z");
it("parses currencies with exact minor units and rejects excess fractional digits", () => {
  expect(conditionFields("budget").parse({ currency: "CHF", amount: "12.05", basis: "trip" })).toEqual({ type: "budget", limit: { currency: "CHF", amountMinor: 1205 }, basis: "trip" });
  expect(() => conditionFields("budget").parse({ currency: "JPY", amount: "12.50", basis: "trip" })).toThrow();
});
it("validates real dates at the same Proposal boundary and preserves requested uncertainty", () => {
  const fields = conditionFields("dates");
  const r = fields.parse({ start: "2026-10-01", startLatest: "2026-10-03", end: "", endLatest: "" });
  expect(applyTripProposal(trip, editTripConstraint(trip, "date", r)).request.constraints[0]?.requirement).toEqual(r);
  expect(() => editTripConstraint(trip, "date", fields.parse({ start: "2026-02-30" }))).toThrow();
  expect(() => fields.parse({ start: "2026-10-01", end: "2026-09-01" })).toThrow();
});
it("editing mobility preserves unrelated train restrictions", () => {
  const r = conditionFields("mobility", { type: "mobility", excludedTrainNames: ["のぞみ"], carAvailable: true }).parse({ minutes: "120", transfers: "2", car: "false" });
  expect(r).toEqual({ type: "mobility", excludedTrainNames: ["のぞみ"], maxTravelMinutes: 120, maxTransfers: 2, carAvailable: false });
  expect(() => conditionFields("mobility").parse({ transfers: "4" })).toThrow();
});
it("enforces text bounds without interpreting markup", () => {
  expect(conditionFields("origin").parse({ name: "<img src=x>" })).toMatchObject({ place: { name: "<img src=x>", sources: [] } });
  expect(() => conditionFields("experience").parse({ text: "x".repeat(241) })).toThrow();
});
