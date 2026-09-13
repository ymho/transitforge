import { expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { tripPlacesPreview } from "./trip-places-preview";
import { multiCityTrip, placeActivity, placesTripId, placesAt } from "../../../../modules/trip/domain/trip-places.fixture";

it("shows a display hint, ordered visits, and distinct overnight places without inferred geography", () => {
  expect(tripPlacesPreview(multiCityTrip())).toBe("オーストリア・スイス\n\n訪問予定: Vienna → Salzburg → Salzburgの宿 → Zürich\n\n宿泊予定: Salzburgの宿");
});
it("supports single-city and empty plans without a single-destination fallback", () => {
  expect(tripPlacesPreview(createTrip(placesTripId, "旅", placesAt, [placeActivity("a", { name: "札幌", sources: [] })])))
    .toBe("訪問予定: 札幌\n\n宿泊予定: 未選択");
  expect(tripPlacesPreview(createTrip(placesTripId, "旅", placesAt))).toBe("訪問予定: 未採用\n\n宿泊予定: 未選択");
});
