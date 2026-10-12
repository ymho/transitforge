import { it, expect } from "vitest";
import { tripPartyLabel } from "./trip-party-presentation";
import type { TripParty } from "@raiquora/trip/trip-party";

it.each([
  [{ adults: 2, children: [] }, "大人2人"],
  [{ adults: 2, children: [{}] }, "大人2人 + 子ども1人（年齢未確認）"],
  [{ adults: 2, children: [{ ageGroup: "preschool" }] }, "大人2人 + 子ども1人（幼児）"],
  [{ adults: 2, children: [], composition: ["partner"] }, "夫婦2人"],
  [{ adults: 2, children: [], composition: ["friends"] }, "友人2人"],
  [{ adults: 0, children: [{}] }, "子ども1人（年齢未確認）"],
  [{ adults: 2, children: [{ age: 7, ageGroup: "elementary" }] }, "大人2人 + 子ども1人（7歳・小学生）"],
])("renders anonymous party %j", (fields, expected) => {
  expect(tripPartyLabel({ ...fields as Omit<TripParty, "source">, source: "user" })).toBe(expected);
});

it("uses accepted partial party data consistently in the header and its manual editor", async () => {
  const { createTrip } = await import("@raiquora/trip/trip");
  const { acceptedTripParty, tripPartyView } = await import("./trip-party-presentation");
  const { proposeUserParty } = await import("./update-trip-request");
  const { applyTripProposal } = await import("@raiquora/trip/trip");
  const base = createTrip("11111111-1111-4111-8111-111111111111", "家族旅行", "2026-10-01T00:00:00Z", [], { constraints: [], assumptions: [], partialConditions: [{
    factId: "party", sourceOperationId: "party-op", target: "party_size", scope: { type: "conversation" }, frame: "actual", modality: "preferred", precision: "exact",
    value: { kind: "party", adults: 2, children: [{ age: 5 }] }, provenance: { kind: "user_turn", turnId: "turn" },
  }] });
  expect(acceptedTripParty(base.request)).toEqual({ adults: 2, children: [{ age: 5 }], source: "user" });
  expect(tripPartyView(base)?.text).toContain("5歳");
  const after = applyTripProposal(base, proposeUserParty(base, { adults: 3, children: [{ age: 5 }] }));
  expect(tripPartyView(after)?.text).toContain("大人3人");
  expect(after.request.partialConditions).toEqual([]);
});
