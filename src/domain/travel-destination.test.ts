import { describe, expect, it } from "vitest";

import { recommendedTravelDestinations, travelDestinationAccess } from "./travel-destination";

describe("travel destinations", () => {
  it("puts a history-oriented destination first", () => {
    expect(recommendedTravelDestinations({
      preferences: { history: 0.8, nature: 0.3 },
    } as never)[0]?.name).toBe("出雲大社");
  });

  it("resolves the stay area and access station for a landmark", () => {
    expect(travelDestinationAccess("出雲大社に行きたい")).toMatchObject({
      accommodationDestination: "出雲",
      accessStation: "出雲市",
    });
  });
});
