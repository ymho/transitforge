import { describe, expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { projectRailSchedule, selectRailJourney } from "@raiquora/trip/selected-rail-journey";
import { railSelectionFixture } from "../../../modules/trip/domain/selected-rail-journey.fixture";
import { PathGeometryIndex } from "./train-position";
import { projectTripRouteGeometry } from "./trip-route-geometry";

function fixture() {
  const value = railSelectionFixture();
  value.inputs[0]!.index.trains.forEach((train, index) => {
    train.path_id = `path-${index}`; train.stops[0]!.route_meter = 25; train.stops[1]!.route_meter = 75;
  });
  const journey = selectRailJourney(value.candidate, value.inputs, value.selectedAt);
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "rail", value.selectedAt, [{
    id: "rail", title: "rail", type: "transport", schedule: projectRailSchedule(journey), detail: { status: "selected", mode: "rail", journey },
  }]);
  const geometry = new PathGeometryIndex([0, 1].map((index) => ({ path_id: `path-${index}`, coord_count: 3,
    route_length_m: 100, bbox: [135 + index, 35, 136 + index, 35], route_coords: [[135 + index, 35], [135.5 + index, 35], [136 + index, 35]] })));
  return { trip, index: value.inputs[0]!.index, geometry };
}

describe("Trip route geometry", () => {
  it("slices every adopted rail leg from its verified service and stop indexes", () => {
    const { trip, index, geometry } = fixture(); const routes = projectTripRouteGeometry(trip, index, geometry);
    expect(routes.map((route) => [route.itemId, route.legId])).toEqual([["rail", "leg-1"], ["rail", "leg-2"]]);
    expect(routes[0]!.coordinates).toEqual([[135.25, 35], [135.5, 35], [135.75, 35]]);
  });

  it.each(["day", "uid", "number", "station", "path", "meter"])("does not draw a mismatched timetable: %s", (kind) => {
    const { trip, index, geometry } = fixture(); const changed = structuredClone(index);
    if (kind === "day") changed.service_date = "2026-09-14";
    if (kind === "uid") changed.trains[0]!.service_uid = "other";
    if (kind === "number") changed.trains[0]!.train_no = "other";
    if (kind === "station") changed.trains[0]!.stops[0]!.station_name = "other";
    if (kind === "path") delete changed.trains[0]!.path_id;
    if (kind === "meter") delete changed.trains[0]!.stops[0]!.route_meter;
    expect(projectTripRouteGeometry(trip, changed, geometry).map((route) => route.legId)).not.toContain("leg-1");
  });
});
