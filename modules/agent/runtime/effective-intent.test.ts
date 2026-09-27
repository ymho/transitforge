import { describe, expect, it } from "vitest";
import { emptyConversationIntentOverlay, type ConversationIntentFact, type ConversationIntentTombstone } from "@raiquora/trip/conversation-intent";
import type { TripRequest } from "@raiquora/trip/trip-request";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import { compileEffectiveIntent, effectiveProfileContext } from "./effective-intent";

const turnId = "00000000-0000-4000-8000-000000000001";
const base: TripRequest = { goal: "静かな旅", constraints: [
  { id: "user-experience", strength: "soft", source: "user", scope: { type: "trip" }, requirement: { type: "experience", intent: "prefer", text: "町歩き" } },
  { id: "profile-experience", strength: "soft", source: "profile", scope: { type: "trip" }, requirement: { type: "experience", intent: "prefer", text: "温泉" } },
], assumptions: [] };
const profile = (): UserProfile => ({ version: 3, usualOrigin: "京都駅", interests: ["nature","food","history"], considerations: "歩きすぎず、静かな宿を好む", updatedAt: "2026-09-25T00:00:00Z" });

describe("compileEffectiveIntent Profile V3", () => {
  it("keeps conversation interests separate from unrelated persisted conditions and Profile hints", () => {
    const overlay = { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [fact("actual", "美術館")] };
    const effective = compileEffectiveIntent({ baseRequest: base, baseSource: "conversation_draft", baseRevision: 4, profile: profile(), profileRevision: 8, overlay });
    expect(effective.activeBaseFacts.map(({ ref }) => ref)).toEqual(["constraint:user-experience"]);
    expect(effective.profileHints.map(({ attribute }) => attribute).sort()).toEqual(["considerations","experience:温泉","interest:food","interest:history","interest:nature","origin"]);
    expect(effective.actualConversationFacts).toHaveLength(1);
  });
  it("does not let a hypothetical branch shadow actual persisted intent", () => {
    const effective = compileEffectiveIntent({ baseRequest: base, baseSource: "trip", baseRevision: 7,
      overlay: { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [fact("hypothetical", "美術館")] } });
    expect(effective.activeBaseFacts.map(({ ref }) => ref)).toEqual(["constraint:user-experience"]);
    expect(effective.profileHints.map(({ ref }) => ref)).toEqual(["constraint:profile-experience"]);
    expect(effective.actualConversationFacts).toEqual([]); expect(effective.hypotheticalFacts).toHaveLength(1);
  });
  it("keeps a retract tombstone authoritative over old Request and Profile values", () => {
    const tombstone: ConversationIntentTombstone = { tombstoneId: "tombstone-1", target: "experience", scope: { type: "conversation" }, frame: "actual", sourceOperationId: "op-1", reason: "retracted" };
    const effective = compileEffectiveIntent({ baseRequest: base, baseSource: "trip", profile: profile(), overlay: { ...emptyConversationIntentOverlay(), intentRevision: 2, tombstones: [tombstone] } });
    expect(effective.activeBaseFacts).toEqual([]); expect(effective.profileHints.filter(({ target }) => target === "experience")).toEqual([]);
  });
  it("does not let a food preference erase other interests", () => {
    const effective = compileEffectiveIntent({ profile: profile(), profileRevision: 8,
      overlay: { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [fact("actual", "食")] } });
    expect(effective.profileHints.filter(({ attribute }) => attribute.startsWith("interest:")).map(({ attribute }) => attribute))
      .toEqual(["interest:nature","interest:history"]);
  });
  it("does not resurrect Profile origin after user returns origin to undecided", () => {
    const originUnknown: ConversationIntentFact = { ...fact("actual", "未定"), target: "origin", value: { kind: "unknown", reason: "undecided" } };
    const effective = compileEffectiveIntent({ profile: profile(), profileRevision: 8,
      overlay: { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [originUnknown] } });
    expect(effective.profileHints.some(({ target }) => target === "origin")).toBe(false);
  });
  it("keeps Profile inheritance suppressed after accepted unknown is consumed into Trip", () => {
    const effective = compileEffectiveIntent({ profile: profile(), profileRevision: 8, baseSource: "trip", baseRevision: 2,
      baseRequest: { constraints: [], assumptions: [], profileSuppressions: [{ id: "profile-suppression:origin", target: "origin", scope: { type: "conversation" }, sourceOperationId: "origin-unknown", reason: "explicit_unknown" }] },
      overlay: emptyConversationIntentOverlay() });
    expect(effective.profileHints.some(({ target }) => target === "origin")).toBe(false);
  });
  it("projects only the three V3 concepts as reference-only hints", () => {
    const p = profile(), effective = compileEffectiveIntent({ profile: p, profileRevision: 8, overlay: emptyConversationIntentOverlay() });
    expect(effectiveProfileContext(effective)).toMatchObject({ source: { profileVersion: 3, profileRevision: 8 }, application: "reference_only",
      usualOrigin: "京都駅", favoriteInterests: ["自然","食","歴史"], considerations: p.considerations });
    expect(effective.ignoredProfileSettings).toEqual([]);
    expect(effective.profileHints.every(({ application }) => application === "reference_only")).toBe(true);
  });
  it("Profile has no party hint and current Conversation party still overrides Trip party", () => {
    const partyFact: ConversationIntentFact = { factId: "party", target: "party_size", scope: { type: "conversation" }, modality: "preferred", precision: "exact",
      value: { kind: "party", adults: 1, children: [{}] }, frame: "actual", sourceOperationId: "party", provenance: { kind: "user_turn", turnId, quote: "1人" } };
    const effective = compileEffectiveIntent({ profile: profile(), baseRequest: { constraints: [], assumptions: [], party: { adults: 2, children: [], source: "user" } }, baseSource: "trip",
      overlay: { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [partyFact] } });
    expect(effective.activeBaseParty).toBeUndefined(); expect(effective.profileHints.some(({ target }) => target === "party_size")).toBe(false);
  });
});
function fact(frame: "actual"|"hypothetical", text: string): ConversationIntentFact {
  return { factId: `fact-${frame}`, target: "experience", scope: { type: "conversation" }, modality: "preferred", precision: "qualitative",
    value: { kind: "text", text }, frame, sourceOperationId: `op-${frame}`, provenance: { kind: "user_turn", turnId, quote: text } };
}
