import { describe, expect, it } from "vitest";
import { profileIntroductionGreeting } from "./travel-profile-panel";

describe("profileIntroductionGreeting", () => {
  it("夜間はこんばんはと案内する", () => {
    expect(profileIntroductionGreeting(new Date("2026-08-16T21:00:00"))).toBe("こんばんは");
    expect(profileIntroductionGreeting(new Date("2026-08-16T10:00:00"))).toBe("こんにちは");
  });
});
