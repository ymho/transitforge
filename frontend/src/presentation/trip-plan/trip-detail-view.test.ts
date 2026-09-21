// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { multiCityTrip, resolvedPlace } from "../../../../modules/trip/domain/trip-places.fixture";
import { tripMapProjection, tripOverviewCopy, renderTripMap } from "./trip-detail-view";

describe("Trip detail projections", () => {
  it("uses only adopted retained places and does not invent route geometry or coordinates", () => {
    const trip = multiCityTrip();
    const view = tripMapProjection(trip);
    expect(view.places.map((place) => place.name)).toEqual(["Vienna", "Salzburg", "Salzburgの宿", "Zürich"]);
    expect(view.located).toEqual([]); expect(view.unknown).toHaveLength(4);
    expect(tripOverviewCopy(trip)).toContain("日程は未定");
  });

  it("opens the existing map only for a retained coordinate and keeps unknown places usable", () => {
    const trip = multiCityTrip(); const place = resolvedPlace("座標あり");
    const withCoordinate = { ...trip, items: [...trip.items, { id: "located", title: "座標あり", type: "activity" as const,
      category: "sightseeing" as const, schedule: { type: "unscheduled" as const }, place: { ...place, coordinate: { longitude: 135, latitude: 35 } } }] };
    const open = vi.fn(), focus = vi.fn(), root = renderTripMap(withCoordinate, open, focus);
    const located = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "座標あり")!;
    located.click(); expect(focus).toHaveBeenCalledWith("located"); expect(open).toHaveBeenCalledWith("located");
    const unknown = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Zürich")!;
    unknown.click(); expect(focus).toHaveBeenCalledWith("activity"); expect(open).toHaveBeenCalledTimes(1);
  });
});
