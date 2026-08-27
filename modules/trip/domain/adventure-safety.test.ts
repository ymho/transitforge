import { describe, expect, it } from "vitest";
import { adventureIntensityFromRequest, assessAdventureActivity } from "./adventure-safety";
describe("assessAdventureActivity", () => {
  it("does not confuse intensity with permission", () => { expect(assessAdventureActivity("city-walk", 3)).toEqual(expect.objectContaining({ intensity: 3, allowed: true, requiresCurrentEvidence: false })); });
  it("offers a controlled alternative for avoided risks", () => { expect(assessAdventureActivity("border-crossing", 3, ["unverified-border"])).toEqual(expect.objectContaining({ allowed: false, saferAlternative: "city-walk", requiresCurrentEvidence: true })); });
  it("recognizes an adventure request without persisting it as a profile", () => { expect(adventureIntensityFromRequest("なんか危ない楽しみ方ない？")).toBe(2); });
});
