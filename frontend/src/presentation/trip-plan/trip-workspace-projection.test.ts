import { describe, expect, it } from "vitest";
import { createTrip, type Trip, type ItineraryItem } from "@raiquora/trip/trip";
import { selectRailJourney, projectRailSchedule } from "@raiquora/trip/selected-rail-journey";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { multiCityTrip, placeActivity, placeStay, placesTripId, placesAt } from "../../../../modules/trip/domain/trip-places.fixture";
import { transportModes } from "@raiquora/trip/transport-detail";
import { itineraryDay, itineraryItemCopy, tripWorkspaceProjection, tripProposalProjection } from "./trip-workspace-projection";

describe("Trip V2 workspace projections", () => {
  it("marks schedule/place/selection/party assumptions only while unconfirmed", () => {
    const trip: Trip = { ...multiCityTrip(), items: [...multiCityTrip().items, { id: "unselected", title: "宿未定", type: "stay", schedule: { type: "unscheduled" }, selection: { status: "unselected" } }, placeActivity("unknown")],
      request: { constraints: [], party: { adults: 1, children: [], source: "assumption", assumptionId: "party" }, assumptions: [
        { id: "place", text: "仮の場所", status: "unconfirmed", source: "model", affects: [{ type: "item", itemId: "activity", field: "place" }] },
        { id: "selection", text: "宿の仮定", status: "unconfirmed", source: "model", affects: [{ type: "item", itemId: "unselected", field: "selection" }] },
        { id: "schedule", text: "仮の時間", status: "unconfirmed", source: "model", affects: [{ type: "item", itemId: "activity", field: "schedule" }] },
        { id: "party", text: "仮の人数", status: "unconfirmed", source: "model", affects: [{ type: "party" }] },
        { id: "rejected", text: "却下した場所", status: "rejected", source: "model", affects: [{ type: "item", itemId: "unknown", field: "place" }] },
        { id: "confirmed", text: "確認済みの場所", status: "confirmed", source: "model", affects: [{ type: "item", itemId: "activity", field: "place" }] },
      ] } };
    const view = tripWorkspaceProjection(trip);
    expect(view.assumptions.map((a) => a.target)).toEqual(["Zürichの場所", "宿未定の採用内容", "Zürichの日時", "今回の人数"]);
    expect(view.party).toContain("仮置き"); expect(itineraryItemCopy(trip.items[3]!)).toContain("宿泊先未選択");
  });
  it("renders all manual transport modes and unresolved modes without rail assumptions", () => {
    for (const mode of transportModes) {
      const unresolved: ItineraryItem = { id: mode, title: mode, type: "transport", detail: { status: "unresolved", mode }, schedule: { type: "unscheduled" } };
      expect(itineraryItemCopy(unresolved)).toContain("未確定");
      if (mode === "rail") continue;
      const selected: ItineraryItem = { ...unresolved, detail: { status: "selected", mode, origin: { name: "A", sources: [] }, destination: { name: "B", sources: [] }, provenance: { type: "manual" } } };
      expect(itineraryItemCopy(selected)).toContain("A → B"); expect(itineraryItemCopy(selected)).toContain("未検証");
    }
  });
  it("uses rail scheduled facts, never delayed observations", () => {
    const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
    const item: ItineraryItem = { id: "rail", title: "鉄道", type: "transport", schedule: projectRailSchedule(journey), detail: { mode: "rail", status: "selected", journey } };
    const copy = itineraryItemCopy(item); expect(copy).toContain("09:00"); expect(copy).not.toContain("09:10"); expect(copy).toContain("計画時刻"); expect(copy).toContain("2M");
  });
  it("groups authored dates and keeps unscheduled separate, not browser timezone", () => {
    const fixed: ItineraryItem = { ...placeActivity("fixed"), schedule: { type: "fixed", startAt: { at: "2026-09-22T23:30:00-04:00", timeZone: "America/New_York" } } };
    const window: ItineraryItem = { ...placeActivity("window"), schedule: { type: "window", earliestStart: { at: "2026-09-22T09:00:00+02:00", timeZone: "Europe/Vienna" }, latestEnd: { at: "2026-09-22T12:00:00+02:00", timeZone: "Europe/Vienna" }, durationMinutes: 90 } };
    const trip = createTrip(placesTripId, "旅", placesAt, [placeActivity("free"), fixed, window, placeStay("stay", "宿")]);
    expect(itineraryDay(fixed)).toBe("2026-09-22");
    const view = tripWorkspaceProjection(trip);
    expect(view.days.map(([date, items]) => [date, items.map((i) => i.id)])).toEqual([["2026-09-22", ["fixed", "window", "stay"]], ["日時未定", ["free"]]]);
    expect(itineraryItemCopy(window)).toContain("約90分"); expect(itineraryItemCopy(window)).toContain("Europe/Vienna");
    expect(itineraryItemCopy(placeStay("stay", "宿"))).toContain("2026-09-23 チェックアウト");
  });
  it("separates destinations, adopted cities, party and field-level assumptions", () => {
    const trip: Trip = { ...multiCityTrip(), request: { party: { adults: 2, children: [{}], source: "user" }, constraints: [
      { id: "wish", strength: "soft", source: "user", scope: { type: "trip" }, requirement: { type: "destinations", places: [{ name: "Paris", sources: [] }], order: "flexible" } },
    ], assumptions: [
      { id: "maybe", text: "午後を想定", status: "unconfirmed", source: "model", affects: [{ type: "item", itemId: "activity", field: "schedule" }] },
      { id: "yes", text: "確認済みの仮定", status: "confirmed", source: "model", affects: [{ type: "item", itemId: "activity", field: "place" }] },
    ] } };
    const view = tripWorkspaceProjection(trip);
    expect(view.places).toContain("Vienna"); expect(view.places).toContain("Zürich");
    expect(view.party).toContain("大人2人"); expect(view.party).toContain("未確認");
    expect(view.assumptions).toEqual([{ id: "maybe", text: "午後を想定", target: "Zürichの日時" }]);
    const afterRequest = { ...trip.request, constraints: trip.request.constraints.map((c) => ({ ...c, requirement: { type: "destinations" as const, places: [{ name: "London", sources: [] }], order: "flexible" as const } })) };
    const diff = tripProposalProjection(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "希望先を変更", patches: [{ type: "request", request: afterRequest }] });
    expect(diff.beforeConditions).toContain("Paris"); expect(diff.afterConditions).toContain("London"); expect(trip.request).not.toEqual(afterRequest);
  });
  it("shows before/after without changing adopted items", () => {
    const trip = multiCityTrip(), before = structuredClone(trip);
    const view = tripProposalProjection(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "削除案", patches: [{ type: "remove", itemId: "activity" }] });
    expect(view.changes[0]?.before).toContain("Zürich"); expect(view.changes[0]?.after).toBe("この予定はありません"); expect(trip).toEqual(before);
  });
});
