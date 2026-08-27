import { describe, expect, it } from "vitest";
import { recheckDedupeKey, travelRecheckDifference } from "./travel-recheck";
describe("travel recheck", () => {
  it("deduplicates the same trip entity", () => { expect(recheckDedupeKey({ tripPlanId: "trip", kind: "weather", entityId: "izumo" })).toBe("trip:weather:izumo"); });
  it("does not present a failed refresh as current", () => { expect(travelRecheckDifference({ checkedAt: "a", status: "available", fingerprint: "sun", evidence: [] }, { checkedAt: "b", status: "unavailable", evidence: [] })).toEqual(expect.objectContaining({ severity: "major", changed: true })); });
});
