import { describe, expect, it } from "vitest";
import { emptyConversationIntentOverlay, type ConversationIntentFact, type ConversationIntentTombstone } from "@raiquora/trip/conversation-intent";
import type { TripRequest } from "@raiquora/trip/trip-request";
import { compileEffectiveIntent } from "./effective-intent";

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
  it("keeps accepted user-turn facts separate from persisted conditions and Profile hints", () => {
    const overlay = { ...emptyConversationIntentOverlay(), intentRevision: 1, facts: [fact("actual", "美術館")] };
    const effective = compileEffectiveIntent({ baseRequest: base, baseSource: "conversation_draft", baseRevision: 4, overlay });
    expect(effective.actualConversationFacts).toMatchObject([{ target: "experience", provenance: { kind: "user_turn" } }]);
    expect(effective.activeBaseFacts).toEqual([]);
    expect(effective.profileHints).toEqual([]);
    expect(effective.suppressedBaseRefs).toEqual(["constraint:user-experience", "constraint:profile-experience"]);
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
});

function fact(frame: "actual" | "hypothetical", text: string): ConversationIntentFact {
  return { factId: `fact-${frame}`, target: "experience", scope: { type: "conversation" }, modality: "preferred", precision: "qualitative",
    value: { kind: "text", text }, frame, sourceOperationId: `op-${frame}`, provenance: { kind: "user_turn", turnId, quote: text } };
}
