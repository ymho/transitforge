import { expect, it } from "vitest";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { createItineraryCandidateSet, proposePlanAdoption } from "@raiquora/trip/itinerary-candidates";
import { searchSelectionDraft } from "./retain-search-selection.js";
import { trustedCandidateItem } from "./retained-candidate-item.js";

it.each(["stay", "transport"] as const)("preserves a relative %s slot's logical day when adopting a dated search result", kind => {
  const common = { id: "slot", title: "未定", schedule: { type: "relative" as const, dayId: "d1", ...(kind === "stay" ? { endDayId: "d2" } : {}) } };
  const slot = kind === "stay" ? { ...common, type: kind, selection: { status: "unselected" as const } } : { ...common, type: kind, detail: { status: "unresolved" as const, mode: "rail" as const } };
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-10-01T00:00:00Z", [slot], undefined, undefined, undefined,
    { version: 1, logicalDays: [{ id: "d1" }, { id: "d2" }], calendarBindings: [] });
  const candidate = { ...slot, id: "searched", schedule: { type: "day" as const, date: "2026-10-24", ...(kind === "stay" ? { endDate: "2026-10-25" } : {}) } };
  const before = structuredClone(trip), retained = searchSelectionDraft([candidate], trip, "slot")!, draft = retained.variants[0]!.items[0]!;
  expect(draft.logicalDayId).toBe("d1");
  const adopted = trustedCandidateItem(draft, "set", "option-1", candidate, "2026-10-01T00:00:00Z");
  expect(adopted).toMatchObject({ id: "slot", logicalDayId: "d1", schedule: candidate.schedule });
  const set = createItineraryCandidateSet({ id: "set", revision: 1, contextRef: { tripId: trip.id, baseTripRevision: trip.revision, conversationId: trip.id, requestFingerprint: "request" },
    issuedAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-02T00:00:00Z", variants: retained.variants, coverage: retained.coverage });
  const { proposal } = proposePlanAdoption({ candidateSet: set, variantId: "option-1", currentTrip: trip, requestFingerprint: "request", now: "2026-10-01T00:00:00Z",
    trustedFactory: value => trustedCandidateItem(value, "set", "option-1", candidate, "2026-10-01T00:00:00Z") });
  expect(applyTripProposal(trip, proposal).items[0]).toMatchObject({ id: "slot", logicalDayId: "d1", schedule: candidate.schedule });
  expect(applyTripProposal(trip, proposal).timeline).toEqual(trip.timeline);
  expect(trip).toEqual(before);
});
