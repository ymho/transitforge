import { expect, it } from "vitest";
import { partyWithCounts } from "./party-counts";
it("preserves child age details/composition and never silently destroys identified participants", () => {
  const previous = { adults: 2, children: [{ age: 7, ageGroup: "elementary" as const }], composition: ["family" as const], source: "user" as const };
  expect(partyWithCounts(previous, 2, 2)).toEqual({ adults: 2, children: [{ age: 7, ageGroup: "elementary" }, {}], composition: ["family"] });
  const identified = { ...previous, participants: [{ id: "a", role: "adult" as const }, { id: "b", role: "adult" as const }, { id: "c", role: "child" as const }] };
  expect(partyWithCounts(identified, 2, 1).participants).toEqual(identified.participants);
  expect(() => partyWithCounts(identified, 1, 1)).toThrow(); expect(() => partyWithCounts(undefined, 0, 0)).toThrow();
});
