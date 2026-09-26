import { describe, expect, it } from "vitest";
import { emptyConversationIntentOverlay, type ConversationIntentFact, type ConversationIntentTombstone } from "@raiquora/trip/conversation-intent";
import type { TripRequest } from "@raiquora/trip/trip-request";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import { compileEffectiveIntent, effectiveProfileContext } from "./effective-intent";

const turnId = "00000000-0000-4000-8000-000000000001";
const base: TripRequest = {
  goal: "静かな旅",
  constraints: [
    { id: "user-experience", strength: "soft", source: "user", scope: { type: "trip" },
      requirement: { type: "experience", intent: "prefer", text: "町歩き" } },
    { id: "profile-experience", strength: "soft", source: "profile", scope: { type: "trip" },
      requirement: { type: "experience", intent: "prefer", text: "温泉" } },
  ],
  assumptions: [],
};

describe("compileEffectiveIntent", () => {
  it("keeps an added interest separate from unrelated persisted conditions and Profile hints", () => {
    const overlay = { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [fact("actual", "美術館")] };
    const effective = compileEffectiveIntent({ baseRequest: base, baseSource: "conversation_draft", baseRevision: 4, overlay });
    expect(effective.actualConversationFacts).toMatchObject([{ target: "experience", provenance: { kind: "user_turn" } }]);
    expect(effective.activeBaseFacts.map(({ ref }) => ref)).toEqual(["constraint:user-experience"]);
    expect(effective.profileHints.map(({ ref }) => ref)).toEqual(["constraint:profile-experience"]);
    expect(effective.suppressedBaseRefs).toEqual([]);
    expect(effective.base).toMatchObject({ source: "conversation_draft", revision: 4 });
  });

  it("does not let a hypothetical branch shadow actual persisted intent", () => {
    const overlay = { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [fact("hypothetical", "美術館")] };
    const effective = compileEffectiveIntent({ baseRequest: base, baseSource: "trip", baseRevision: 7, overlay });
    expect(effective.activeBaseFacts.map(({ ref }) => ref)).toEqual(["constraint:user-experience"]);
    expect(effective.profileHints.map(({ ref }) => ref)).toEqual(["constraint:profile-experience"]);
    expect(effective.actualConversationFacts).toEqual([]);
    expect(effective.hypotheticalFacts).toHaveLength(1);
    expect(effective.suppressedBaseRefs).toEqual([]);
  });

  it("keeps a retract tombstone authoritative over old Request and Profile values", () => {
    const tombstone: ConversationIntentTombstone = { tombstoneId: "tombstone-1", target: "experience", scope: { type: "conversation" },
      frame: "actual", sourceOperationId: "op-1", reason: "retracted" };
    const overlay = { ...emptyConversationIntentOverlay(), intentRevision: 2, tombstones: [tombstone] };
    const effective = compileEffectiveIntent({ baseRequest: base, baseSource: "trip", baseRevision: 7, overlay });
    expect(effective.activeBaseFacts).toEqual([]);
    expect(effective.profileHints).toEqual([]);
    expect(effective.retractions).toEqual([tombstone]);
  });

  it("produces the same fingerprint for the same validated base and overlay", () => {
    const overlay = { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [fact("actual", "美術館")] };
    const first = compileEffectiveIntent({ baseRequest: structuredClone(base), baseSource: "trip", baseRevision: 1, overlay });
    const second = compileEffectiveIntent({ baseRequest: structuredClone(base), baseSource: "trip", baseRevision: 1, overlay: structuredClone(overlay) });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(compileEffectiveIntent({ baseRequest: base, baseSource: "trip", baseRevision: 2, overlay }).fingerprint).not.toBe(first.fingerprint);
  });

  it("does not let a food preference erase other interests", () => {
    const profile = userProfile();
    const overlay = { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [fact("actual", "食")] };
    const effective = compileEffectiveIntent({ profile, profileRevision: 8, overlay });
    expect(effective.profileHints.filter(({ attribute }) => attribute.startsWith("interest:")).map(({ attribute }) => attribute))
      .toEqual(["interest:nature", "interest:history"]);
    expect(effective.actualConversationFacts).toHaveLength(1);
  });

  it("keeps a trip-wide pace hint when only one logical day is overridden", () => {
    const dayPace: ConversationIntentFact = { ...fact("actual", "活発"), target: "pace", scope: { type: "logical_day", logicalDayId: "day-2" } };
    const effective = compileEffectiveIntent({ profile: userProfile(), profileRevision: 8,
      overlay: { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [dayPace] } });
    expect(effective.profileHints.some(({ attribute }) => attribute === "pace")).toBe(true);
  });

  it("does not resurrect a Profile origin after the user returns origin to undecided", () => {
    const originUnknown: ConversationIntentFact = { ...fact("actual", "未定"), target: "origin", value: { kind: "unknown", reason: "undecided" } };
    const effective = compileEffectiveIntent({ profile: userProfile(), profileRevision: 8,
      overlay: { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [originUnknown] } });
    expect(effective.profileHints.some(({ target }) => target === "origin")).toBe(false);
  });

  it("keeps Profile inheritance suppressed after the accepted unknown is consumed into a Trip", () => {
    const effective = compileEffectiveIntent({ profile: userProfile(), profileRevision: 8, baseSource: "trip", baseRevision: 2,
      baseRequest: { constraints: [], assumptions: [], profileSuppressions: [{ id: "profile-suppression:origin", target: "origin",
        scope: { type: "conversation" }, sourceOperationId: "origin-unknown", reason: "explicit_unknown" }] },
      overlay: emptyConversationIntentOverlay() });
    expect(effective.profileHints.some(({ target }) => target === "origin")).toBe(false);
    expect(effective.profileSuppressions).toHaveLength(1);
  });

  it("preserves exact retained values and records legacy fields as ignored without deleting them", () => {
    const profile = userProfile();
    const effective = compileEffectiveIntent({ profile, profileRevision: 8, overlay: emptyConversationIntentOverlay() });
    const context = effectiveProfileContext(effective)!;
    expect(context).toMatchObject({ source: { profileVersion: 2, profileRevision: 8 }, pace: 0.5,
      favoriteInterests: ["自然", "食", "歴史"], consentedPreferenceNotes: { food: profile.notes!.food } });
    expect(JSON.stringify(context)).not.toContain("0.65");
    expect(profile.travelStyle.walkingTolerance).toBe(0.65);
    expect(effective.profileHints.some(({ attribute }) => attribute.startsWith("mobility:") || attribute.startsWith("tolerance:"))).toBe(false);
    expect(JSON.stringify(context)).toContain(profile.notes!.food);
    expect(effective.ignoredProfileSettings).toEqual(expect.arrayContaining([
      { path: "companions.usualPartySize", reason: "trip_specific" },
      { path: "travelStyle.novelty", reason: "unused_setting" },
      { path: "transport.maxTypicalTravelMinutes", reason: "trip_specific" },
      { path: "notes.budget", reason: "trip_specific" },
    ]));
    expect(profile.companions.usualPartySize).toBe(4);
  });

  it("keeps one-field Profile changes distinguishable instead of bucketing medium and high values", () => {
    const medium = userProfile(), high = structuredClone(medium); high.travelStyle.pace = 0.9;
    const left = compileEffectiveIntent({ profile: medium, profileRevision: 8, overlay: emptyConversationIntentOverlay() });
    const right = compileEffectiveIntent({ profile: high, profileRevision: 9, overlay: emptyConversationIntentOverlay() });
    expect(effectiveProfileContext(left)?.pace).toBe(0.5);
    expect(effectiveProfileContext(right)?.pace).toBe(0.9);
    expect(right.fingerprint).not.toBe(left.fingerprint);
  });
});

function fact(frame: "actual" | "hypothetical", text: string): ConversationIntentFact {
  return { factId: `fact-${frame}`, target: "experience", scope: { type: "conversation" }, modality: "preferred", precision: "qualitative",
    value: { kind: "text", text }, frame, sourceOperationId: `op-${frame}`, provenance: { kind: "user_turn", turnId, quote: text } };
}

function userProfile(): UserProfile {
  return { version: 2, home: { station: "京都駅", carAvailable: true }, companions: { usual: ["family"], children: [{ ageGroup: "elementary" }], usualPartySize: 4 },
    travelStyle: { pace: 0.5, novelty: 0.8, walkingTolerance: 0.65 }, preferences: { nature: 0.4, food: 0.75, history: 0.9 },
    transport: { preferredMode: "rail", maxTypicalTravelMinutes: 120 }, notes: { budget: "普段の予算", food: "季節の料理を少量ずつ。".repeat(30) },
    aiNoteFields: ["food"], updatedAt: "2026-09-25T00:00:00Z" };
}


it("keeps unconsented notes and hidden legacy preferences out of model input without deleting saved data", () => {
  const profile = userProfile();
  profile.notes = { ...profile.notes, lodging: "PRIVATE_LODGING_NOTE", avoidances: "PRIVATE_AVOID_NOTE" };
  const original = structuredClone(profile);
  const effective = compileEffectiveIntent({ profile, overlay: emptyConversationIntentOverlay() });
  expect(JSON.stringify(effective)).not.toContain("PRIVATE_LODGING_NOTE");
  expect(JSON.stringify(effective)).not.toContain("PRIVATE_AVOID_NOTE");
  expect(effective.profileHints.map(({ attribute }) => attribute).sort()).toEqual(["interest:food", "interest:history", "interest:nature", "note:food", "origin", "pace"]);
  expect(profile).toEqual(original);
});
