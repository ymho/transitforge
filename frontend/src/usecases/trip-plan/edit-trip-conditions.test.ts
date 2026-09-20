import { expect, it } from "vitest";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { editTripConstraint, editTripParty } from "./edit-trip-conditions";
const trip = () => createTrip("11111111-1111-4111-8111-111111111111", "旅行", "2026-09-19T00:00:00Z");
it("replaces a hypothesis with explicit input and removes reciprocal links without changing items", () => {
  const t = { ...trip(), request: { constraints: [{ id: "pace", source: "assumption" as const, strength: "soft" as const, scope: { type: "trip" as const }, assumptionId: "guess", requirement: { type: "pace" as const, value: .5 } }], assumptions: [{ id: "guess", source: "model" as const, status: "unconfirmed" as const, text: "普段のペース", affects: [{ type: "constraint" as const, constraintId: "pace" }] }] } };
  const after = applyTripProposal(t, editTripConstraint(t, "pace", { type: "pace", value: .2 }));
  expect(after.request.constraints[0]).toMatchObject({ source: "user", requirement: { value: .2 } });
  expect(after.request.constraints[0]!.assumptionId).toBeUndefined(); expect(after.request.assumptions[0]!.affects).toEqual([]); expect(after.items).toEqual(t.items);
});
it("removes a condition and permits an unknown party without inventing counts", () => {
  const t = applyTripProposal(trip(), editTripConstraint(trip(), "origin", { type: "origin", place: { name: "大阪", sources: [] } }));
  expect(applyTripProposal(t, editTripConstraint(t, "origin", undefined)).request.constraints).toEqual([]);
  const withParty = applyTripProposal(t, editTripParty(t, "2", "?,5"));
  expect(withParty.request.party?.children).toEqual([{}, { age: 5 }]);
  expect(applyTripProposal(withParty, editTripParty(withParty, "", "")).request.party).toBeUndefined();
});
it("rejects empty/invalid counts, reversed dates and invalid money", () => {
  for (const [adults, children] of [["", "5"], ["-1", ""], ["2", "NaN"], ["0", ""]]) expect(() => editTripParty(trip(), adults!, children!)).toThrow();
  expect(() => editTripConstraint(trip(), "date", { type: "dates", start: { earliest: "2026-09-30", latest: "2026-09-30" }, end: { earliest: "2026-09-20", latest: "2026-09-20" } })).toThrow();
});
