import { describe, it, expect } from "vitest";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import type { ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import { proposeActivitySelection, proposeManualActivity, type ResolvedActivityCandidate } from "./propose-trip-activity";
import { activityCandidateFixture } from "./activity-selection.fixture";

const trip = () => createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-12T08:00:00Z");
const placement = { itemId: "meal", operation: "add" as const };
const request = { candidateId: "activity-a", taskId: "task-a" };
const now = "2026-09-12T08:00:00Z";
const select = (record: ResolvedActivityCandidate, records = [record]) => proposeActivitySelection(trip(), placement, request, { resolve: async () => records }, now);
describe("trusted Activity adoption", () => {
  it.each(["restaurant", "experience"] as const)("adopts %s without candidates/volatile fields or invented place identity", async (kind) => {
    const sourceTrip = trip(), before = structuredClone(sourceTrip);
    const record = activityCandidateFixture(sourceTrip.id, kind);
    Object.assign(record.result, { raw: { bad: true }, review: 4.9, availability: "available" });
    Object.assign(record.place, { image: "bad", review: 5, raw: {} });
    const proposal = await proposeActivitySelection(sourceTrip, placement, request, { resolve: async () => [record] }, now);
    expect(proposal.patches[0]).toMatchObject({ type: "add", item: { type: "activity", category: kind === "restaurant" ? "food" : "experience" } });
    const result = applyTripProposal(sourceTrip, proposal);
    expect(result.items).toHaveLength(1); expect(sourceTrip).toEqual(before);
    expect(result.items[0]!.schedule).toEqual(kind === "restaurant" ? { type: "unscheduled" } : { type: "day", date: "2026-09-22" });
    const item = result.items[0]!;
    if (item.type !== "activity") throw new Error("Expected activity");
    expect(item.place?.ref?.providerPlaceId).toBe("restaurant-a"); // Experience ID is not a venue ID.
    expect(item.place?.sources[0]?.sourceId).toBe(kind === "restaurant" ? "restaurant-a" : "experience-a");
    for (const key of ["raw", "price", "review", "availability", "image", "genre", "bookingUrl", "budget", "openingHours"]) expect(JSON.stringify(item)).not.toContain(`"${key}`);
  });
  it.each([
    (r: ResolvedActivityCandidate) => { r.targetBinding = { status: "unresolved", reason: "missing-binding" }; },
    (r: ResolvedActivityCandidate) => { r.targetBinding = { status: "mismatch", reason: "different-id" }; },
    (r: ResolvedActivityCandidate) => { r.providerItemId = "other"; },
    (r: ResolvedActivityCandidate) => { r.provider = "other"; },
    (r: ResolvedActivityCandidate) => { r.candidateId = "other"; },
    (r: ResolvedActivityCandidate) => { r.tripId = "other"; },
    (r: ResolvedActivityCandidate) => { r.taskId = "other"; },
    (r: ResolvedActivityCandidate) => { r.validUntil = "2026-09-01T00:00:00Z"; },
    (r: ResolvedActivityCandidate) => { r.source = { ...r.source, confidence: "unknown" }; },
    (r: ResolvedActivityCandidate) => { r.source = { ...r.source, retrievedAt: "2026-09-13T00:00:00Z" }; },
    (r: ResolvedActivityCandidate) => { r.placeRetention = { origin: "provider", provider: "fixture", storage: "unknown", allowedFields: ["name", "sources"] }; },
    (r: ResolvedActivityCandidate) => { r.placeRetention = { origin: "manual" }; },
    (r: ResolvedActivityCandidate) => { r.retainTitle = false; },
    (r: ResolvedActivityCandidate) => { if (r.kind === "restaurant") r.result.providerRestaurantId = "other"; },
  ])("rejects identity/scope/evidence/retention tampering %#", async (mutate) => {
    const record = activityCandidateFixture(trip().id); mutate(record);
    await expect(select(record)).rejects.toThrow();
  });
  it("rejects missing/ambiguous candidate and propagates partial lookup failure without a patch", async () => {
    const record = activityCandidateFixture(trip().id);
    await expect(select(record, [])).rejects.toThrow();
    await expect(select(record, [record, record])).rejects.toThrow();
    await expect(proposeActivitySelection(trip(), placement, request, { resolve: async () => { throw new Error("offline"); } }, now)).rejects.toThrow("offline");
  });
  it("rejects experience identity/date retention mismatch", async () => {
    const record = activityCandidateFixture(trip().id, "experience");
    record.retainSchedule = false; await expect(select(record)).rejects.toThrow();
    record.retainSchedule = true;
    if (record.kind === "experience") record.result.providerItemId = "different-tour";
    await expect(select(record)).rejects.toThrow();
  });
  it("rejects changed experience dates and permission laundering through an explicit schedule", async () => {
    const record = activityCandidateFixture(trip().id, "experience");
    const port = { resolve: async () => [record] };
    await expect(proposeActivitySelection(trip(), placement, { ...request, schedule: { type: "day", date: "2026-09-23" } }, port, now)).rejects.toThrow();
    record.retainSchedule = false;
    await expect(proposeActivitySelection(trip(), placement, { ...request, schedule: { type: "day", date: "2026-09-22" } }, port, now)).rejects.toThrow();
  });
  it("changes candidate A to B through explicit replace and preserves other items", async () => {
    const a = activityCandidateFixture(trip().id); const first = applyTripProposal(trip(), await select(a));
    const b = structuredClone(a); b.candidateId = "activity-b";
    if (b.kind === "restaurant") b.result.name = "別の食堂";
    b.place = { ...b.place, name: "別の食堂" };
    const proposal = await proposeActivitySelection(first, { itemId: "meal", operation: "replace" }, { ...request, candidateId: "activity-b" }, { resolve: async () => [b] }, now);
    expect(proposal.patches[0]?.type).toBe("replace");
    expect(applyTripProposal(first, proposal)).toMatchObject({ planningState: "itinerary_refinement", items: [{ id: "meal", title: "別の食堂" }] });
    expect(first.items[0]!.title).toBe("評価用の森の食堂");
  });
});
describe("manual plan intention", () => {
  const schedules: ItinerarySchedule[] = [{ type: "unscheduled" }, { type: "day", date: "2026-09-22" },
    { type: "window", earliestStart: { at: "2026-09-22T14:00:00+09:00", timeZone: "Asia/Tokyo" },
      latestEnd: { at: "2026-09-22T16:00:00+09:00", timeZone: "Asia/Tokyo" }, durationMinutes: 120 }];
  it.each(schedules)("preserves $type and place-less free time/food", (schedule) => {
    for (const category of ["food", "free-time"] as const) {
      const input = { title: "休憩", category, schedule }; const before = structuredClone(input);
      const result = applyTripProposal(trip(), proposeManualActivity(trip(), placement, input));
      expect(result.items[0]).toEqual({ ...input, id: "meal", type: "activity" });
      expect(result.items[0]).not.toHaveProperty("place"); expect(input).toEqual(before);
    }
  });
  it("does not grant model/manual authority to provider places or raw fields", () => {
    const base = { title: "休憩", category: "food" as const, schedule: { type: "unscheduled" as const } };
    expect(() => proposeManualActivity(trip(), placement, { ...base, place: activityCandidateFixture(trip().id).place })).toThrow();
    expect(() => proposeManualActivity(trip(), placement, { ...base, raw: {} } as typeof base)).toThrow();
    expect(() => proposeManualActivity(trip(), { ...placement, afterId: "" }, base)).toThrow();
  });
});
