import { expect, it } from "vitest";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import { savedTransportEndpoints, savedTransportSearchConstraints } from "./saved-transport-search-context";
import { compileEffectiveIntent } from "./effective-intent";
import { validateToolIntentUse } from "./intent-action-policy";
import { createSearchJourneysTool } from "./search-journeys-tool";
import { selectedTripItemSnapshot } from "./agent-context-snapshot";
import { railSelectionFixture } from "../../trip/domain/selected-rail-journey.fixture";
import { selectRailJourney } from "@raiquora/trip/selected-rail-journey";

const item: ItineraryItem = { id: "outward", type: "transport", title: "向日町駅 → 姫路駅（13:00着予定）",
  detail: { status: "unresolved", mode: "rail" }, schedule: { type: "day", date: "2026-11-02" } };
const trip = () => createTrip("22222222-2222-4222-8222-222222222222", "リンゴ狩り2026", "2026-10-11T00:00:00Z", [item],
  { goal: "リンゴ狩り", constraints: [], assumptions: [] });
const descriptor = createSearchJourneysTool({} as never);
const input = { originStation: "向日町駅", destinationStation: "姫路駅", serviceDate: "2026-11-02", departureTimeMinutes: 680 };

it("uses a focused saved route label without another registration turn or invented departure time", () => {
  const saved = trip(), before = structuredClone(saved);
  const effective = compileEffectiveIntent({ baseRequest: saved.request, baseSource: "trip", overlay: emptyConversationIntentOverlay(),
    searchContextConstraints: savedTransportSearchConstraints(saved, item.id) });
  expect(validateToolIntentUse(descriptor, input, effective).accepted).toBe(true);
  expect(effective.activeBaseFacts.map(({ scope, authority }) => ({ scope, authority }))).toEqual(Array.from({ length: 3 }, () => ({
    scope: { type: "item", itemId: item.id }, authority: "legacy",
  })));
  expect(effective.actualConversationFacts).toEqual([]);
  expect(selectedTripItemSnapshot(item)).toMatchObject({ origin: "向日町駅", destination: "姫路駅", originIsProvisional: true, selectionStatus: "unresolved" });
  expect(selectedTripItemSnapshot(item)).not.toHaveProperty("departureTimeMinutes");
  expect(saved).toEqual(before);
  expect(saved.request.constraints).toEqual([]);
});

it("uses structured saved endpoints before a conflicting display title", () => {
  const manual: ItineraryItem = { ...item, title: "旧出発地 → 旧到着地", detail: { status: "selected", mode: "car",
    origin: { name: "京都駅", sources: [] }, destination: { name: "姫路駅", sources: [] }, provenance: { type: "manual" } } };
  expect(savedTransportEndpoints(manual)).toEqual({ origin: "京都駅", destination: "姫路駅", provisional: false });
});

it("uses the first/last adopted rail stops and service date rather than route labels", () => {
  const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
  const rail: ItineraryItem = { ...item, title: "旧出発地 → 旧到着地", detail: { status: "selected", mode: "rail", journey } };
  expect(savedTransportEndpoints(rail)).toEqual({ origin: "A", destination: "C", provisional: false });
  const conditions = savedTransportSearchConstraints({ ...trip(), items: [rail] }, rail.id);
  expect(conditions.at(-1)?.requirement).toEqual({ type: "dates", start: { earliest: "2026-09-13", latest: "2026-09-13" } });
});

it("resolves a saved logical day binding without inventing a date for an unbound day", () => {
  const relative: ItineraryItem = { ...item, schedule: { type: "relative", dayId: "first" } };
  const saved = { ...trip(), items: [relative], timeline: { version: 1 as const, logicalDays: [{ id: "first" }],
    calendarBindings: [{ logicalDayId: "first", date: "2026-11-02", timeZone: "Asia/Tokyo", basis: "explicit" as const }] } };
  expect(savedTransportSearchConstraints(saved, item.id)).toHaveLength(3);
  expect(savedTransportSearchConstraints({ ...saved, timeline: { ...saved.timeline, calendarBindings: [] } }, item.id)).toHaveLength(2);
});

it.each(["向日町駅から姫路駅へ", "向日町駅 → 京都駅 → 姫路駅", "未定 → 姫路駅", "向日町駅 → 未定", "移動を相談"])
("does not guess endpoints from ambiguous label %s", title => {
  expect(savedTransportEndpoints({ ...item, title })).toBeUndefined();
});

it("does not inherit another item or manufacture an undated transport date", () => {
  const saved = trip();
  expect(savedTransportSearchConstraints(saved)).toEqual([]);
  expect(savedTransportSearchConstraints(saved, "unknown")).toEqual([]);
  const undated = { ...saved, items: [{ ...item, schedule: { type: "unscheduled" as const } }] };
  const effective = compileEffectiveIntent({ baseRequest: undated.request, overlay: emptyConversationIntentOverlay(),
    searchContextConstraints: savedTransportSearchConstraints(undated, item.id) });
  expect(validateToolIntentUse(descriptor, input, effective).recovery).toMatchObject({ target: "start_date", reason: "not_accepted" });
});

it("does not restore an origin the traveller explicitly withdrew", () => {
  const saved = trip();
  const request = { ...saved.request, profileSuppressions: [{ id: "unknown-origin", target: "origin" as const,
    scope: { type: "conversation" as const }, sourceOperationId: "op:origin", reason: "explicit_unknown" as const }] };
  const effective = compileEffectiveIntent({ baseRequest: request, overlay: emptyConversationIntentOverlay(),
    searchContextConstraints: savedTransportSearchConstraints(saved, item.id) });
  expect(effective.activeBaseFacts.some(({ target }) => target === "origin")).toBe(false);
  expect(validateToolIntentUse(descriptor, input, effective).recovery).toMatchObject({ target: "origin", reason: "not_accepted" });
});

it.each([false, true])("preserves the current explicit origin (unknown=%s) over a saved label", unknown => {
  const saved = trip(), turnId = "33333333-3333-4333-8333-333333333333";
  const effective = compileEffectiveIntent({ baseRequest: saved.request, overlay: { ...emptyConversationIntentOverlay(), intentRevision: 1,
    facts: [{ factId: "current-origin", sourceOperationId: "op:origin", target: "origin", scope: { type: "conversation" },
      frame: "actual", modality: "preferred", precision: "exact", provenance: { kind: "user_turn", turnId, quote: "今回の出発地" },
      value: unknown ? { kind: "unknown", reason: "undecided" } : { kind: "place_label", label: "京都駅" } }] },
    searchContextConstraints: savedTransportSearchConstraints(saved, item.id) });
  expect(effective.activeBaseFacts.some(({ target }) => target === "origin")).toBe(false);
  expect(validateToolIntentUse(descriptor, { ...input, originStation: "京都駅" }, effective).accepted).toBe(!unknown);
});
