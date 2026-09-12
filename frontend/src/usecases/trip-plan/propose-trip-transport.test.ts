import { describe, it, expect } from "vitest";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { proposeManualTransport, proposeTransportSelection } from "./propose-trip-transport";
import { transportCandidateFixture } from "./transport-selection.fixture";
import { transportPreview } from "./transport-preview";
import type { ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";

const at = "2026-09-12T08:00:00Z";
const trip = () => createTrip("11111111-1111-4111-8111-111111111111", "旅", at);
const placement = { itemId: "move", operation: "add" as const };
const input = { title: "空港へ", mode: "taxi" as const, origin: "ホテル", destination: "空港", schedule: { type: "unscheduled" as const } };
describe("manual transport proposal", () => {
  it.each([
    { type: "unscheduled" }, { type: "day", date: "2026-09-22" },
    { type: "window", earliestStart: { at: "2026-09-22T08:00:00+09:00", timeZone: "Asia/Tokyo" }, latestEnd: { at: "2026-09-22T12:00:00+09:00", timeZone: "Asia/Tokyo" } },
  ] as ItinerarySchedule[])("adds and replaces with %j without writing the original", (schedule) => {
    const t = trip(), before = structuredClone(t);
    const p = proposeManualTransport(t, placement, { ...input, schedule });
    const preview = applyTripProposal(t, p);
    const replacement = proposeManualTransport(preview, { ...placement, operation: "replace" }, { ...input, mode: "air", schedule });
    expect(replacement.patches[0]?.type).toBe("replace");
    const updated = applyTripProposal(preview, replacement);
    expect(updated.items).toHaveLength(1); expect(t).toEqual(before);
    const i = updated.items[0]!; if (i.type !== "transport") throw new Error("fixture");
    for (const s of ["飛行機", "ホテル → 空港", "未検証"]) expect(transportPreview(i)).toContain(s);
  });
  it.each(["provider", "sources", "retention", "providerItemId", "price", "note"])("rejects unexposed %s on manual input", (key) => {
    expect(() => proposeManualTransport(trip(), placement, { ...input, [key]: "not-trusted" })).toThrow();
  });
  it("rejects missing replace, duplicate add, invalid insertion and nested provider place", () => {
    const t = trip();
    expect(() => proposeManualTransport(t, { ...placement, operation: "replace" }, input)).toThrow();
    expect(() => proposeManualTransport(t, { ...placement, afterId: "missing" }, input)).toThrow();
    const updated = applyTripProposal(t, proposeManualTransport(t, placement, input));
    expect(() => proposeManualTransport(updated, placement, input)).toThrow();
    expect(() => proposeManualTransport(t, placement, { ...input, origin: { name: "fake", provider: "x" } as unknown as string })).toThrow();
  });
});
describe("provider-backed transport resolution", () => {
  it.each(["air", "ferry", "bus"] as const)("adopts %s through ID and retains no raw, price, inventory or realtime fields", async (mode) => {
    const t = trip(), record = transportCandidateFixture(t.id, mode);
    Object.assign(record, { raw: { token: "not-a-secret-test" }, price: 100, availability: "available", delayMinutes: 5, bookingUrl: "https://example.com/book" });
    Object.assign(record.origin, { imageUrl: "https://example.com/img", rating: 4 });
    const before = structuredClone(record);
    const p = await proposeTransportSelection(t, placement, { candidateId: record.candidateId, taskId: record.taskId }, { resolve: async () => [record] }, at);
    const i = applyTripProposal(t, p).items[0]!;
    expect(i).toMatchObject({ type: "transport", schedule: record.schedule, detail: { mode, status: "selected", provenance: { type: "provider", providerItemId: "service-a" } } });
    expect(JSON.stringify(i)).not.toMatch(/raw|price|availability|delayMinutes|bookingUrl|imageUrl|rating/);
    expect(record).toEqual(before); expect(t.items).toEqual([]);
  });
  it.each(["candidate", "trip", "task", "expired", "source", "source-kind", "provider", "confidence", "future", "valid-from", "valid-until", "identity-retention", "source-retention", "title-retention", "schedule-retention", "place-retention", "place-binding", "endpoint-unverified", "ambiguous", "missing"])("rejects %s without a proposal", async (bad) => {
    const t = trip(), r = transportCandidateFixture(t.id);
    if (bad === "candidate") r.candidateId = "wrong";
    if (bad === "trip") r.tripId = "wrong";
    if (bad === "task") r.taskId = "wrong";
    if (bad === "expired") r.validUntil = "2026-09-11T00:00:00Z";
    if (bad === "source") r.source.sourceId = "wrong";
    if (bad === "source-kind") r.source.kind = "restaurant";
    if (bad === "provider") r.source.provider = "wrong";
    if (bad === "confidence") r.source.confidence = "unknown";
    if (bad === "future") r.source.retrievedAt = "2026-09-14T00:00:00Z";
    if (bad === "valid-from") r.source.validFrom = "2026-09-14T00:00:00Z";
    if (bad === "valid-until") r.source.validUntil = "2026-09-11T00:00:00Z";
    if (bad === "identity-retention") r.retainIdentity = false;
    if (bad === "source-retention") r.retainSource = false;
    if (bad === "title-retention") r.retainTitle = false;
    if (bad === "schedule-retention") r.retainSchedule = false;
    if (bad === "place-retention") r.originRetention = { origin: "manual" };
    if (bad === "place-binding") r.origin = { name: "unverified", sources: [] };
    if (bad === "endpoint-unverified") r.origin = { ...r.origin, sources: [{ ...r.source, confidence: "unknown" }] };
    await expect(proposeTransportSelection(t, placement, { candidateId: "transport-a", taskId: "task-a" },
      { resolve: async () => bad === "missing" ? [] : bad === "ambiguous" ? [r, r] : [r] }, at)).rejects.toThrow();
    expect(t.items).toEqual([]);
  });
  it("replaces A with resolved B, not an upsert or accumulated candidate array", async () => {
    const t = trip(), a = transportCandidateFixture(t.id), b = transportCandidateFixture(t.id, "ferry");
    b.candidateId = "transport-b"; b.providerItemId = "service-b"; b.source = { ...b.source, id: "source-b", sourceId: "service-b" };
    const port = { resolve: async (id: string) => [a, b].filter((r) => r.candidateId === id) };
    const adopted = applyTripProposal(t, await proposeTransportSelection(t, placement, { candidateId: a.candidateId, taskId: a.taskId }, port, at));
    const proposal = await proposeTransportSelection(adopted, { ...placement, operation: "replace" }, { candidateId: b.candidateId, taskId: b.taskId }, port, at);
    const changed = applyTripProposal(adopted, proposal);
    expect(proposal.patches[0]?.type).toBe("replace"); expect(changed.items).toHaveLength(1);
    expect(changed.items[0]).toMatchObject({ detail: { mode: "ferry", provenance: { providerItemId: "service-b" } } });
    expect(adopted.items[0]).toMatchObject({ detail: { mode: "air", provenance: { providerItemId: "service-a" } } });
    await expect(proposeTransportSelection(t, placement, { candidateId: a.candidateId, taskId: a.taskId, providerItemId: "injected" } as never, port, at)).rejects.toThrow();
  });
});
