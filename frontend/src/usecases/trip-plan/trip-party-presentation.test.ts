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
