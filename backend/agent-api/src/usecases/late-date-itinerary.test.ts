import { expect, it, vi } from "vitest";
import { createTrip, applyTripProposal, type Trip } from "@raiquora/trip/trip";
import { createItineraryCandidateSet, proposePlanAdoption, type ItineraryCandidateSet } from "@raiquora/trip/itinerary-candidates";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule } from "@raiquora/trip/selected-rail-journey";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { searchSelectionDraft } from "./retain-search-selection.js";
import { trustedCandidateItem } from "./retained-candidate-item.js";
import { PlanCandidateRetentionApplication, registerPlanCandidateRetentionTool } from "./plan-candidate-retention.js";

const now = "2026-09-12T08:00:00Z";
const id = "11111111-1111-4111-8111-111111111111";
function chosenTrip() {
  const initial = createTrip(id, "旅", now, [
    { id: "rail", title: "向日町駅→天橋立駅", type: "transport", detail: { status: "unresolved", mode: "rail" }, schedule: { type: "relative", dayId: "d1" } },
    { id: "visit", title: "天橋立ビューランド", type: "activity", category: "sightseeing", schedule: { type: "relative", dayId: "d1" } },
    { id: "return", title: "帰り", type: "transport", detail: { status: "unresolved", mode: "rail" }, schedule: { type: "relative", dayId: "d2" } },
  ], undefined, undefined, undefined, { version: 1, logicalDays: [{ id: "d1", label: "1日目" }, { id: "d2", label: "2日目" }], calendarBindings: [] });
  const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
  const candidate = { id: "searched", title: initial.items[0]!.title, type: "transport" as const,
    detail: { status: "selected" as const, mode: "rail" as const, journey }, schedule: projectRailSchedule(journey) };
  const draft = searchSelectionDraft([candidate], initial, "rail")!;
  const set = createItineraryCandidateSet({ id: "search", revision: 0, contextRef: { tripId: id, baseTripRevision: 0, conversationId: id, requestFingerprint: "request" },
    variants: draft.variants, coverage: draft.coverage, selectionItems: draft.selectionItems, issuedAt: now, expiresAt: "2026-09-13T00:00:00Z" });
  const { proposal } = proposePlanAdoption({ candidateSet: set, variantId: "option-1", currentTrip: initial, requestFingerprint: "request", now,
    trustedFactory: value => trustedCandidateItem(value, "search", "option-1", candidate, now) });
  return { initial, chosen: applyTripProposal(initial, proposal), candidate };
}
function toolsFor(trip: Trip) {
  let saved: ItineraryCandidateSet | undefined;
  const put = vi.fn(async (_owner, value: ItineraryCandidateSet) => { saved = value; });
  const app = new PlanCandidateRetentionApplication({ put, get: async () => saved }, () => new Date(now));
  const tools = new AgentToolRegistry();
  registerPlanCandidateRetentionTool(tools, app, { principal: { subject: "owner" }, executionId: "addition", conversationId: id, userRequest: "ピューロランドを追加して", tripId: id,
    baseTripRevision: trip.revision, baseItemIds: trip.items.map(item => item.id), baseDayIds: trip.timeline!.logicalDays.map(day => day.id), currentTrip: trip }, vi.fn());
  return { tools, put, saved: () => saved };
}

it("adopts a dated route into its original day, then adds only the requested activity without recreating existing plans", async () => {
  const { initial, chosen, candidate } = chosenTrip(), before = structuredClone(chosen);
  expect(chosen.items.map(item => item.id)).toEqual(["rail", "visit", "return"]);
  expect(chosen.items[0]).toMatchObject({ id: "rail", logicalDayId: "d1", schedule: candidate.schedule, detail: candidate.detail });
  expect(chosen.timeline!.calendarBindings).toEqual([
    { logicalDayId: "d1", date: "2026-09-13", timeZone: "Asia/Tokyo", basis: "explicit" },
    { logicalDayId: "d2", date: "2026-09-14", timeZone: "Asia/Tokyo", basis: "sequential" },
  ]);
  expect(projectDailyItinerary(chosen).days).toHaveLength(2);
  expect(chosen.items[1]).toEqual(initial.items[1]);
  const f = toolsFor(chosen);
  const result = await f.tools.execute("draft_itinerary", { variants: [{ label: "追加案", dayCount: 2, items: [
    { kind: "transport", title: "向日町駅 → 天橋立駅", day: 1 },
    { kind: "activity", title: "天橋立ビューランド", day: 1 },
    { kind: "activity", title: "ピューロランド", day: 1 },
  ] }], unknowns: ["新しい訪問先の時刻は未定"] }, { executionId: "addition" });
  expect(result.ok).toBe(true);
  expect(f.saved()!.variants[0]!.items.map(item => item.title)).toEqual(["ピューロランド"]);
  expect(f.saved()!.variants[0]!.retainedBaseItemIds).toEqual(["rail", "visit", "return"]);
  const { proposal } = proposePlanAdoption({ candidateSet: f.saved()!, variantId: "plan-1", currentTrip: chosen,
    requestFingerprint: f.saved()!.contextRef.requestFingerprint, now,
    trustedFactory: value => trustedCandidateItem(value, "addition", "plan-1") });
  const after = applyTripProposal(chosen, proposal);
  expect(after.items).toHaveLength(4);
  expect(after.items.filter(item => chosen.items.some(saved => saved.id === item.id))).toEqual(chosen.items);
  expect(after.items.map(item => item.title)).toEqual(["向日町駅→天橋立駅", "天橋立ビューランド", "ピューロランド", "帰り"]);
  expect(after.timeline).toEqual(chosen.timeline);
  expect(projectDailyItinerary(after).days).toHaveLength(2);
  expect(chosen).toEqual(before);
});

it("does not let a generic draft downgrade a selected route through an existing item ID", async () => {
  const { chosen } = chosenTrip(), f = toolsFor(chosen), before = structuredClone(chosen);
  expect(await f.tools.execute("draft_itinerary", { variants: [{ label: "案", dayCount: 2,
    items: [{ kind: "transport", title: "移動を考え直す", day: 1, baseItemId: "rail" }] }], unknowns: [] }, { executionId: "addition" }))
    .toMatchObject({ ok: false, error: { code: "invalid_input" } });
  expect(f.put).not.toHaveBeenCalled(); expect(chosen).toEqual(before);
});

it("keeps a same-name visit on another day distinct and never merges an ambiguous saved pair", async () => {
  const { chosen } = chosenTrip(), f = toolsFor(chosen);
  expect(await f.tools.execute("draft_itinerary", { variants: [{ label: "別の日", dayCount: 2,
    items: [{ kind: "activity", title: "天橋立ビューランド", day: 2 }] }], unknowns: [] }, { executionId: "addition" })).toMatchObject({ ok: true });
  expect(f.saved()!.variants[0]!.items).toHaveLength(1);
  const ambiguous = toolsFor({ ...chosen, items: [...chosen.items, { ...chosen.items[1]!, id: "duplicate" }] });
  expect(await ambiguous.tools.execute("draft_itinerary", { variants: [{ label: "追加", dayCount: 2,
    items: [{ kind: "activity", title: "天橋立ビューランド", day: 1 }, { kind: "activity", title: "ピューロランド", day: 1 }] }], unknowns: [] }, { executionId: "addition" }))
    .toMatchObject({ ok: false, error: { code: "invalid_input" } });
  expect(ambiguous.put).not.toHaveBeenCalled();
});
