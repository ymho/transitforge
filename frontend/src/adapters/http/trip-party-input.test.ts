import { describe, it, expect } from "vitest";
import { tripPartyProviderInput } from "./trip-party-input";
import type { TripParty } from "@raiquora/trip/trip-party";

const party: TripParty = { adults: 2, children: [{ age: 7 }, { ageGroup: "preschool" }, {}], source: "user" };
describe("operation-scoped party input adaptation", () => {
  it("allows counts-only discovery without child ages or private metadata", () => {
    const before = structuredClone(party);
    expect(tripPartyProviderInput(party, { toolName: "restaurant_discovery", requiresExactChildAges: false })).toEqual({ ok: true, input: { adults: 2, children: 3, total: 5 } });
    expect(party).toEqual(before);
  });
  it("returns actual missing exact ages only for an operation requiring them, never fills from ageGroup", () => {
    const result = tripPartyProviderInput(party, { toolName: "hotel_availability", requiresExactChildAges: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing input");
    expect(result.missing.map((m) => m.inputName)).toEqual(["party.children.1.age", "party.children.2.age"]);
    expect(result.missing.every((m) => m.reason === "tool_input_missing" && m.toolName === "hotel_availability")).toBe(true);
    expect(result).not.toHaveProperty("input");
  });
  it("copies exact ages including zero only when needed, without interpreting provider fare bands", () => {
    expect(tripPartyProviderInput({ ...party, children: [{ age: 0 }, { age: 7 }] }, { toolName: "hotel_availability", requiresExactChildAges: true }))
      .toEqual({ ok: true, input: { adults: 2, children: 2, total: 4, childAges: [0, 7] } });
  });
});
