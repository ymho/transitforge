import { describe, expect, it } from "vitest";
import { parseConversationWorkingState, presentationFromObservation, resolvePresentedCandidate } from "./conversation-working-state";

describe("ConversationWorkingState", () => {
  it("resolves the actual presented order and rejects another version", () => {
    const state = parseConversationWorkingState({ version: 1, revision: 4,
      sourceTurnId: "33333333-3333-4333-8333-333333333333", sourceUserSequence: 21,
      target: { conversationId: "11111111-1111-4111-8111-111111111111" },
      presentations: [{ presentationId: "33333333-3333-4333-8333-333333333333", version: 1,
        entries: [{ ordinal: 1, candidateRef: "candidate:b" }, { ordinal: 2, candidateRef: "candidate:a" }] }],
      pendingQuestionRefs: [], pendingProposalRefs: [] });
    expect(resolvePresentedCandidate({ state, presentationId: state.presentations[0]!.presentationId, version: 1, ordinal: 2 })).toBe("candidate:a");
    expect(resolvePresentedCandidate({ state, presentationId: state.presentations[0]!.presentationId, version: 2, ordinal: 2 })).toBeUndefined();
  });
  it("rejects unbounded or private payload fields", () => {
    const base = { version: 1, revision: 0, sourceTurnId: "33333333-3333-4333-8333-333333333333", sourceUserSequence: 1,
      target: { conversationId: "11111111-1111-4111-8111-111111111111" }, presentations: [], pendingQuestionRefs: [], pendingProposalRefs: [] };
    expect(() => parseConversationWorkingState({ ...base, rawConversation: "private" })).toThrow("Invalid working state");
    expect(() => parseConversationWorkingState({ ...base, lastOutcome: { outcome: "answer", progress: [], reasoning: "private" } }))
      .toThrow("Invalid working state");
  });
  it("maps only actually presented candidate order", () => {
    expect(presentationFromObservation("33333333-3333-4333-8333-333333333333", { outcome: "progress", progress: [
      { kind: "candidates", refs: ["candidate:b", "candidate:a"] }, { kind: "itinerary", refs: ["draft:1"] },
    ] })?.entries.map(({ candidateRef }) => candidateRef)).toEqual(["candidate:b", "candidate:a"]);
  });
});
