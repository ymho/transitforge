import { describe, expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { compileEffectiveIntent } from "./effective-intent";
import { reduceConversationIntent } from "./conversation-intent-reducer";
import { emptyConversationIntentOverlay, type AcceptedIntentDelta } from "@raiquora/trip/conversation-intent";
import { proposeVerifiedIntentRequest } from "./verified-intent-proposal";

const conversationId = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const turnId = "33333333-3333-4333-8333-333333333333";

describe("verified intent proposal", () => {
  it("projects verified user facts with provenance without replacing an unrelated interest", () => {
    const trip = createTrip(tripId, "旅", "2026-09-25T00:00:00Z", [], { constraints: [
      { id: "museum", source: "user", strength: "soft", scope: { type: "trip" }, requirement: { type: "experience", intent: "prefer", text: "美術館" } },
    ], assumptions: [] });
    const reduced = apply({ action: "add_alternative", target: "experience", value: { kind: "text", text: "食事重視" }, modality: "preferred" });
    const effectiveIntent = compileEffectiveIntent({ baseRequest: trip.request, baseSource: "trip", baseRevision: 0, overlay: reduced.overlay });
    const proposal = proposeVerifiedIntentRequest({ conversationId, trip, effectiveIntent, receipt: reduced.receipt });
    expect(proposal?.patches[0]).toMatchObject({ type: "request", request: { constraints: [
      { id: "museum", requirement: { text: "美術館" } },
      { source: "user", requirement: { text: "食事重視" }, semantic: { facts: [{ sourceOperationId: `intent-op:${turnId}:1` }] } },
    ] } });
    expect(proposal?.intentBinding).toMatchObject({ conversationId, intentRevision: 1, changes: [{ groupRef: `intent-group:${turnId}:1`, target: "experience" }] });
  });

  it("persists an explicit unknown origin as removal and never promotes it to an assumption", () => {
    const trip = createTrip(tripId, "旅", "2026-09-25T00:00:00Z", [], { constraints: [
      { id: "origin", source: "profile", strength: "soft", scope: { type: "trip" }, requirement: { type: "origin", place: { name: "東京", sources: [] } } },
    ], assumptions: [] });
    const reduced = apply({ action: "set", target: "origin", value: { kind: "unknown", reason: "undecided" }, modality: "preferred" });
    const effectiveIntent = compileEffectiveIntent({ baseRequest: trip.request, baseSource: "trip", baseRevision: 0, overlay: reduced.overlay });
    const proposal = proposeVerifiedIntentRequest({ conversationId, trip, effectiveIntent, receipt: reduced.receipt });
    expect(proposal?.patches[0]).toEqual({ type: "request", request: { constraints: [], assumptions: [] } });
    expect(proposal?.intentBinding?.changes).toHaveLength(1);
  });

  it("does not bind hypothetical or model-only meaning as a user proposal", () => {
    const trip = createTrip(tripId, "旅", "2026-09-25T00:00:00Z");
    const reduced = apply({ action: "set", target: "destination", value: { kind: "place_label", label: "京都" }, modality: "preferred", frame: "hypothetical" });
    const effectiveIntent = compileEffectiveIntent({ baseRequest: trip.request, baseSource: "trip", baseRevision: 0, overlay: reduced.overlay });
    expect(proposeVerifiedIntentRequest({ conversationId, trip, effectiveIntent, receipt: reduced.receipt })).toBeUndefined();
  });
});

function apply(operation: { action: "set" | "add_alternative"; target: "origin" | "destination" | "experience"; value: AcceptedIntentDelta["operations"][number]["value"]; modality: "preferred"; frame?: "actual" | "hypothetical" }) {
  return reduceConversationIntent(emptyConversationIntentOverlay(), { version: 1, mutationId: `intent-turn:${turnId}`, baseIntentRevision: 0, speechAct: "inform", operations: [{
    operationId: `intent-op:${turnId}:1`, groupId: `intent-group:${turnId}:1`, action: operation.action, target: operation.target,
    scope: { type: "conversation" }, modality: operation.modality, precision: "exact", value: operation.value!, frame: operation.frame ?? "actual",
    provenance: { kind: "user_turn", turnId, quote: "明示条件" },
  }] });
}
