import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createPresentedCandidateController, stableSelectionMutation } from "./presented-candidate-selection.js";
import { PlanCandidateRetentionApplication } from "../plan-candidate-retention.js";
import type { ConversationMessage } from "../../contracts/server-state.js";
import { conversationId, stateMetadata } from "../../adapters/state-dynamodb.fixture.js";
import { stateA } from "../../adapters/state-dynamodb.fixture.js";
import { TripResourceError } from "../../contracts/trip-api.js";

const at = "2026-10-04T00:00:00Z";
const trip = createTrip(stateMetadata().tripId, "出雲", at);
async function fixture(labels = ["案1"]) {
  const retention = new PlanCandidateRetentionApplication({ put: vi.fn(), get: vi.fn() }, () => new Date(at));
  const retained = await retention.retain({ principal: stateA, executionId: "72200000-0000-4000-8000-000000000001", conversationId,
    tripId: trip.id, baseTripRevision: trip.revision, userRequest: "旅程を作って" }, { coverage: { coveredScopes: ["日別"], omittedScopes: [], complete: true },
    variants: labels.map((label, index) => ({ id: `plan-${index + 1}`, label, timeline: { dayOrder: [], itemOrder: ["item"] },
      items: [{ componentId: "item", title: label, kind: "activity", schedule: { type: "unscheduled" }, evidenceRefs: [], placement: { atBeginning: true } }],
      assumptionRefs: [], assessmentRefs: [], changedComponentIds: ["item"], removedBaseItemIds: [], retainedBaseItemIds: [] })) }, []);
  const message: ConversationMessage = { role: "assistant", text: "候補です。", sequence: 2, createdAt: at, publicPlanPresentation: retained.presentation };
  const adoptPlan = vi.fn(async request => request.operation === "preview" ? { status: "confirmation-required" as const, confirmationKey: "a".repeat(64), preview: {} as never } :
    { status: "saved" as const, trip: { ...trip, revision: 1 }, revision: 1, mutationId: request.mutationId });
  const show = vi.fn();
  const controller = createPresentedCandidateController({ messages: [message], trip, conversationId, userSequence: 3,
    executionId: "execution", userRequest: "案1を保存して", adoptPlan, show });
  return { controller, adoptPlan, show, message };
}
describe("Application-owned presented candidate selection", () => {
  it("uses committed IDs, order and kind, never prose as a candidate", async () => {
    const f = await fixture(["案1", "案2"]);
    expect(f.controller.context.groups).toEqual([{ presentationId: "shown:2:plan", kind: "plan", candidates: [
      { candidateId: "plan-1", ordinal: 1, label: "案1" }, { candidateId: "plan-2", ordinal: 2, label: "案2" }] }]);
    await expect(f.controller.review("shown:2:plan")).resolves.toMatchObject({ status: "shown" });
    expect(f.show).toHaveBeenCalledWith({ publicPlanPresentation: f.message.publicPlanPresentation });
    expect(f.adoptPlan).not.toHaveBeenCalled();
  });
  it("passes explicit choice to the same preview/confirm boundary once and returns the actual receipt", async () => {
    const f = await fixture(); const input = { presentationId: "shown:2:plan", candidateId: "plan-1", quote: "案1を保存して", reference: { kind: "label" as const, quote: "案1" } };
    const [a, b] = await Promise.all([f.controller.select(input), f.controller.select(input)]);
    expect(a).toEqual(b); expect(a).toMatchObject({ status: "saved", tripId: trip.id, tripRevision: 1,
      receipt: { id: stableSelectionMutation(conversationId, 3), executionId: "execution", operation: "save", status: "succeeded" } });
    expect(f.adoptPlan).toHaveBeenCalledTimes(2);
    expect(f.adoptPlan.mock.calls[1]).toEqual([expect.objectContaining({ operation: "confirm", variantId: "plan-1" }), { confirmationKey: "a".repeat(64) }]);
    await expect(f.controller.select({ ...input, candidateId: "plan-2" })).resolves.toEqual({ status: "unknown_candidate" });
    expect(f.adoptPlan).toHaveBeenCalledTimes(2);
  });
  it("rejects forged source/candidate and distinguishes stale from ambiguous writes", async () => {
    const f = await fixture();
    await expect(f.controller.select({ presentationId: "shown:2:plan", candidateId: "plan-1", quote: "以前の依頼", reference: { kind: "sole" as const } })).resolves.toEqual({ status: "invalid_source" });
    await expect(f.controller.select({ presentationId: "foreign", candidateId: "plan-1", quote: "保存して", reference: { kind: "sole" as const } })).resolves.toEqual({ status: "unknown_candidate" });
    f.adoptPlan.mockRejectedValue(new TripResourceError("conflict"));
    await expect(f.controller.select({ presentationId: "shown:2:plan", candidateId: "plan-1", quote: "保存して", reference: { kind: "sole" as const } })).resolves.toEqual({ status: "stale" });
    const g = await fixture(); g.adoptPlan.mockRejectedValue(new TripResourceError("unavailable"));
    await expect(g.controller.select({ presentationId: "shown:2:plan", candidateId: "plan-1", quote: "保存して", reference: { kind: "sole" as const } })).rejects.toThrow();
  });
  it("has no candidate when only an assistant sentence mentioned saving", () => {
    const controller = createPresentedCandidateController({ messages: [{ role: "assistant", text: "保存できます", sequence: 2, createdAt: at }],
      trip, conversationId, userSequence: 3, executionId: "execution", userRequest: "保存して", adoptPlan: vi.fn(), show: vi.fn() });
    expect(controller.context).toEqual({ groups: [], itineraryItemCount: 0, canSave: false });
  });
  it("refuses an unmentioned alternative and a sole-candidate claim in a multi-candidate group", async () => {
    const f = await fixture(["案1", "案2"]);
    const controller = createPresentedCandidateController({ messages: [f.message], trip, conversationId, userSequence: 3,
      executionId: "execution", userRequest: "案2は保存しないでください", adoptPlan: f.adoptPlan, show: f.show });
    await expect(controller.select({ presentationId: "shown:2:plan", candidateId: "plan-1", quote: "案2は保存しないでください", reference: { kind: "ordinal", ordinal: 1, quote: "1" } })).resolves.toEqual({ status: "invalid_source" });
    await expect(controller.select({ presentationId: "shown:2:plan", candidateId: "plan-1", quote: "保存", reference: { kind: "sole" } })).resolves.toEqual({ status: "invalid_source" });
    expect(f.adoptPlan).not.toHaveBeenCalled();
  });
  it("keeps a separate itinerary plan addressable when the same answer also shows hotels", async () => {
    const f = await fixture();
    const controller = createPresentedCandidateController({ messages: [{ ...f.message, publicAccommodationPresentation: { version: "public-accommodation-presentation-v1", cards: [{ evidenceId: "hotel-A", name: "宿A", summary: "未選択", retrievedAt: at }] } }],
      trip, conversationId, userSequence: 3, executionId: "execution", userRequest: "案1でお願いします", adoptPlan: f.adoptPlan, show: f.show });
    expect(controller.context.groups.map(group => group.kind)).toEqual(["plan", "accommodation"]);
    await expect(controller.select({ presentationId: "shown:2:plan", candidateId: "plan-1", quote: "案1でお願いします", reference: { kind: "label" as const, quote: "案1" } })).resolves.toMatchObject({ status: "saved" });
  });
  it("keeps hotel identity and duplicate names distinct and replays exact cards", async () => {
    const presentation = { version: "public-accommodation-presentation-v1" as const, cards: [
      { evidenceId: "hotel-A", name: "同名ホテル", summary: "日付A", retrievedAt: at }, { evidenceId: "hotel-B", name: "同名ホテル", summary: "日付B", retrievedAt: at }] };
    const show = vi.fn(), adoptPlan = vi.fn();
    const controller = createPresentedCandidateController({ messages: [{ role: "assistant", text: "ホテルです", sequence: 4, createdAt: at, publicAccommodationPresentation: presentation }],
      trip, conversationId, userSequence: 5, executionId: "execution", userRequest: "ホテル1で", adoptPlan, show });
    await controller.review("shown:4:accommodation"); expect(show).toHaveBeenCalledWith({ publicAccommodationPresentation: presentation });
    expect(controller.context.groups[0]?.candidates.map(value => value.candidateId)).toEqual(["hotel-A", "hotel-B"]);
    await expect(controller.select({ presentationId: "shown:4:accommodation", candidateId: "hotel-A", quote: "ホテル1で", reference: { kind: "ordinal" as const, ordinal: 1, quote: "1" } })).resolves.toEqual({ status: "unavailable" });
    expect(adoptPlan).not.toHaveBeenCalled();
  });
});
