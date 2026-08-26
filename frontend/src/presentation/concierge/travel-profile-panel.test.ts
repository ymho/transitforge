import { describe, expect, it } from "vitest";
import { conciergeWelcomeMessage, profileIntroductionGreeting } from "./travel-profile-panel";
import { akari } from "../../features/concierge/profiles/akari";
import { mia } from "../../features/concierge/profiles/mia";

describe("profileIntroductionGreeting", () => {
  it("夜間はこんばんはと案内する", () => {
    expect(profileIntroductionGreeting(new Date("2026-08-16T21:00:00"))).toBe("こんばんは");
    expect(profileIntroductionGreeting(new Date("2026-08-16T10:00:00"))).toBe("こんにちは");
  });
});

describe("conciergeWelcomeMessage", () => {
  it("コンシェルジュの口調に合わせて挨拶を作る", () => {
    expect(conciergeWelcomeMessage(akari)).toContain("よろしくお願いします");
    expect(conciergeWelcomeMessage(mia)).toContain("よろしくね");
  });
});
