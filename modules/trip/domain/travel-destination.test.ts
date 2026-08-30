import { describe, expect, it } from "vitest";

import {
  extendedStayDestinations,
  travelDestinationAccess,
} from "./travel-destination";

describe("travel destinations", () => {
  it("resolves the stay area and access station for a landmark", () => {
    expect(travelDestinationAccess("出雲大社に行きたい")).toMatchObject({
      accommodationDestination: "出雲",
      accessStation: "出雲市",
    });
  });

  it("returns curated alternatives for an extended stay", () => {
    expect(extendedStayDestinations("宮島へ旅行したい")).toEqual([
      "広島",
      "倉敷美観地区",
    ]);
    expect(extendedStayDestinations("未登録の場所")).toEqual([]);
  });
});
