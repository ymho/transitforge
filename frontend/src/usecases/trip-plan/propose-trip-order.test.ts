import { expect, it } from "vitest";
import { multiCityTrip } from "../../../../modules/trip/domain/trip-places.fixture";
import { proposeTripOrder } from "./propose-trip-order";
it("rejects missing, duplicate and foreign item IDs and skips unchanged order", () => {
  const trip = multiCityTrip(), ids = trip.items.map(item => item.id);
  expect(proposeTripOrder(trip, ids)).toBeUndefined();
  expect(() => proposeTripOrder(trip, ids.slice(1))).toThrow();
  expect(() => proposeTripOrder(trip, [ids[0]!, ids[0]!, ids[2]!])).toThrow();
  expect(() => proposeTripOrder(trip, ["foreign", ...ids.slice(1)])).toThrow();
});
