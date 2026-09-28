import { expect, it } from "vitest";
import { createTrip } from "./trip";
import { proposeTripItemChange } from "./trip-item-proposal";
import { parsePublicTripProposal } from "./public-trip-proposal";

const trip = createTrip("00000000-0000-4000-8000-000000000756", "出雲", "2026-09-28T00:00:00Z");
it("accepts only bounded authored item previews, never injected provider or booking facts", () => {
  const proposal = proposeTripItemChange(trip, { action: "add-activity", itemId: "meal", dayKey: "unscheduled", title: "昼食", category: "food", placeName: "出雲そば" });
  expect(parsePublicTripProposal(proposal)).toEqual(proposal);
  const patch = proposal.patches[0]; if (patch.type !== "add" || patch.item.type !== "activity") throw new Error("bad fixture");
  const altered = (place: object) => ({ ...proposal, patches: [{ ...patch, item: { ...patch.item, place } }, proposal.patches[1]] });
  expect(() => parsePublicTripProposal(altered({ name: "店", sources: [{ sourceId: "fake" }] }))).toThrow();
  expect(() => parsePublicTripProposal(altered({ name: "店", sources: [], coordinate: { latitude: 35, longitude: 132 } }))).toThrow();
  expect(() => parsePublicTripProposal({ ...proposal, patches: [{ ...patch, item: { ...patch.item, booked: true } }, proposal.patches[1]] })).toThrow();
  expect(() => parsePublicTripProposal({ ...proposal, intentBinding: { source: "fake" } })).toThrow();
});
it("admits a user-selected reference but rejects fabricated timestamps and secret URLs at the public boundary", () => {
  const proposal = proposeTripItemChange(trip, { action: "add-researched-activity", itemId: "garden", dayKey: "unscheduled",
    title: "青葉庭園", category: "sightseeing", sourceUrl: "https://example.org/garden", observedAt: "2026-09-26T10:00:00Z" });
  expect(parsePublicTripProposal(proposal)).toEqual(proposal);
  const first = proposal.patches[0]; if (first.type !== "add" || first.item.type !== "activity") throw new Error("bad fixture");
  const mutated = (research: object) => ({ ...proposal, patches: [{ ...first, item: { ...first.item, research } }, proposal.patches[1]] });
  expect(() => parsePublicTripProposal(mutated({ sourceUrl: "https://example.org/?token=private", observedAt: "2026-09-26T10:00:00Z" }))).toThrow();
  expect(() => parsePublicTripProposal(mutated({ sourceUrl: "https://example.org/garden", observedAt: "2026-09-99T10:00:00Z" }))).toThrow();
});
