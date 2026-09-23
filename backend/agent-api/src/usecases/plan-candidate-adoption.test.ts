import { describe, expect, it } from "vitest";
import { createItineraryCandidateSet, type ItineraryCandidateSet } from "@raiquora/trip/itinerary-candidates";
import { applyTripProposal, createTrip, type Trip } from "@raiquora/trip/trip";
import type { TripMutation } from "../contracts/trip-api.js";
import type { CandidateAdoptionPreviewReceipt, ItineraryCandidateRepository } from "../ports/itinerary-candidate-repository.js";
import type { TripPrincipal, TripRepository } from "../ports/trip-repository.js";
import { PlanCandidateAdoptionApplication } from "./plan-candidate-adoption.js";

const owner = { subject: "owner-a" }, other = { subject: "owner-b" };
const tripId = "11111111-1111-4111-8111-111111111111", mutationId = "22222222-2222-4222-8222-222222222222";
const fingerprint = "request-fingerprint-0001";
function fixture() {
  const initial = createTrip(tripId, "旅行", "2026-09-01T00:00:00Z", [{ id: "keep", type: "activity", title: "既存", category: "free-time", schedule: { type: "unscheduled" } }]);
  let trip: Trip = initial;
  const trips: TripRepository = {
    create: async () => { throw new Error("unused"); }, get: async (principal, id) => principal.subject === owner.subject && id === trip.id ? structuredClone(trip) : undefined,
    list: async () => ({ trips: [] }), archive: async () => {},
    applyMutation: async (principal, mutation: TripMutation, prepare) => {
      if (principal.subject !== owner.subject || mutation.baseRevision !== trip.revision) throw Object.assign(new Error("conflict"), { code: "conflict" });
      const prepared = await prepare(structuredClone(trip)); trip = { ...prepared, revision: trip.revision + 1, updatedAt: "2026-09-02T12:00:00Z" }; return structuredClone(trip);
    },
  };
  const set: ItineraryCandidateSet = createItineraryCandidateSet({ id: "set-1", revision: 2,
    contextRef: { conversationId: "conversation-1", requestFingerprint: fingerprint, tripId, baseTripRevision: 0 },
    coverage: { coveredScopes: ["all"], omittedScopes: [], complete: true }, issuedAt: "2026-09-02T00:00:00Z", expiresAt: "2026-09-03T00:00:00Z",
    variants: [{ id: "variant-1", label: "案1", timeline: { dayOrder: ["day-1"], itemOrder: ["new-1"] },
      items: [{ componentId: "new-1", kind: "activity", title: "候補", schedule: { type: "unscheduled" }, evidenceRefs: ["evidence-1"], placement: { afterRef: "keep" } }],
      assumptionRefs: [], assessmentRefs: [], changedComponentIds: ["new-1"], removedBaseItemIds: [], retainedBaseItemIds: ["keep"] }] });
  const candidates: ItineraryCandidateRepository = { put: async () => {}, get: async (principal, conversationId, id, revision) =>
    principal.subject === owner.subject && conversationId === "conversation-1" && id === set.id && revision === set.revision ? structuredClone(set) : undefined };
  let retained: CandidateAdoptionPreviewReceipt | undefined;
  const receipts = { getPreview: async (principal: TripPrincipal, id: string) => principal.subject === owner.subject && retained?.mutationId === id ? structuredClone(retained) : undefined,
    putPreview: async (_principal: TripPrincipal, value: CandidateAdoptionPreviewReceipt) => { retained ??= structuredClone(value); return structuredClone(retained); } };
  const mutations = new Map<string, Trip>();
  const tripApplication = { execute: async (principal: TripPrincipal | undefined, command: unknown) => {
    const value = command as { baseRevision: number; mutationId: string; proposal: Parameters<typeof applyTripProposal>[1] };
    const replay = mutations.get(value.mutationId); if (replay) return { trip: structuredClone(replay), revision: replay.revision };
    const saved = await trips.applyMutation(principal!, { tripId, baseRevision: value.baseRevision, mutationId: value.mutationId, proposal: value.proposal },
      (current) => applyTripProposal(current, value.proposal)); mutations.set(value.mutationId, structuredClone(saved)); return { trip: saved, revision: saved.revision };
  } };
  const application = new PlanCandidateAdoptionApplication(candidates, trips, receipts, tripApplication,
    (draft) => ({ id: "adopted-1", type: "activity", title: draft.title, category: "sightseeing", schedule: draft.schedule }), () => new Date("2026-09-02T06:00:00Z"));
  const request = { operation: "preview" as const, conversationId: "conversation-1", candidateSetId: "set-1", candidateSetRevision: 2,
    variantId: "variant-1", tripId, baseTripRevision: 0, mutationId };
  return { application, request, current: () => structuredClone(trip) };
}

describe("typed plan candidate adoption", () => {
  it("previews a typed Proposal, then requires exact explicit authority before CAS save/read-back", async () => {
    const f = fixture(); const preview = await f.application.execute(owner, f.request) as { confirmationKey: string; preview: { proposal: unknown } };
    expect(preview).toMatchObject({ status: "confirmation-required", preview: { changes: { added: 1, replaced: 0, removed: 0 } } });
    expect(JSON.stringify(preview.preview.proposal)).not.toContain("markdown");
    await expect(f.application.execute(owner, { ...f.request, operation: "confirm" })).rejects.toMatchObject({ code: "confirmation-required" });
    await expect(f.application.execute(owner, { ...f.request, operation: "confirm" }, { confirmationKey: "0".repeat(64) })).rejects.toMatchObject({ code: "confirmation-required" });
    const result = await f.application.execute(owner, { ...f.request, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
    expect(result).toMatchObject({ status: "saved", revision: 1, trip: { items: [{ id: "keep" }, { id: "adopted-1" }] } });
    expect(await f.application.execute(owner, { ...f.request, operation: "confirm" }, { confirmationKey: preview.confirmationKey })).toEqual(result);
    expect(f.current().revision).toBe(1);
  });
  it("rejects other owners, stale Trip revisions, candidate substitutions and forged body authority", async () => {
    const f = fixture();
    await expect(f.application.execute(other, f.request)).rejects.toMatchObject({ code: "not-found" });
    await expect(f.application.execute(owner, { ...f.request, baseTripRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
    await expect(f.application.execute(owner, { ...f.request, candidateSetId: "set-2" })).rejects.toMatchObject({ code: "not-found" });
    await expect(f.application.execute(owner, { ...f.request, confirmationKey: "0".repeat(64) } as never)).rejects.toMatchObject({ code: "invalid-input" });
  });
});
