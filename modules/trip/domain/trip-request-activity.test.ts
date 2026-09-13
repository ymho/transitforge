import { describe, expect, it } from "vitest";
import { applyTripProposal, type ActivityItineraryItem, type StayItineraryItem } from "./trip";
import { validateTripRequest, type PlanAssumption, type TripRequest } from "./trip-request";
import { requestAt, requestRailItem, requestTrip } from "./trip-request.fixture";
import type { ItinerarySchedule } from "./itinerary-schedule";

const activity: ActivityItineraryItem = {
  id: "activity", type: "activity", title: "自由時間", category: "free-time", schedule: { type: "unscheduled" },
};
const place = { name: "散策先", sources: [] };
function assumptionRequest(itemId: string, field: "schedule" | "place" | "selection", status: PlanAssumption["status"]): TripRequest {
  return { constraints: [], assumptions: [{ id: "assumption", text: "予定を仮置き", source: "model", status,
    affects: [{ type: "item", itemId, field }] }] };
}

describe("PlanAssumption item field applicability", () => {
  it.each(["unconfirmed", "confirmed", "rejected"] as const)("rejects Activity selection independently of place and status: %s", (status) => {
    for (const item of [activity, { ...activity, place }]) {
      expect(() => requestTrip(assumptionRequest(item.id, "selection", status), [item])).toThrow("Activity assumption must affect schedule or place");
    }
  });
  it.each(["unconfirmed", "confirmed", "rejected"] as const)("preserves Activity place semantics: %s", (status) => {
    const request = assumptionRequest(activity.id, "place", status);
    expect(() => requestTrip(request, [activity])).not.toThrow();
    const withPlace = () => requestTrip(request, [{ ...activity, place }]);
    if (status === "rejected") expect(withPlace).toThrow("Rejected assumption still supports an item");
    else expect(withPlace).not.toThrow();
  });
  it.each(["unconfirmed", "confirmed", "rejected"] as const)("preserves all Activity schedule precisions independently of place: %s", (status) => {
    const schedules: ItinerarySchedule[] = [
      { type: "unscheduled" }, { type: "day", date: "2026-09-13" },
      { type: "fixed", startAt: requestAt },
      { type: "window", earliestStart: requestAt, latestEnd: requestAt },
    ];
    for (const schedule of schedules) for (const item of [activity, { ...activity, place }]) {
      const validate = () => requestTrip(assumptionRequest(item.id, "schedule", status), [{ ...item, schedule }]);
      if (status === "rejected" && schedule.type !== "unscheduled") expect(validate).toThrow("Rejected assumption still supports an item");
      else expect(validate).not.toThrow();
    }
  });
  it.each(["unconfirmed", "confirmed", "rejected"] as const)("preserves stay selection independently of unresolved place: %s", (status) => {
    const stay: StayItineraryItem = { id: "stay", title: "宿", type: "stay", schedule: { type: "unscheduled" }, selection: { status: "unselected" } };
    const request = assumptionRequest(stay.id, "selection", status);
    expect(() => requestTrip(request, [stay])).not.toThrow();
    expect(() => requestTrip(request, [{ ...stay, selection: { status: "unselected", place } }])).not.toThrow();
    const selected: StayItineraryItem = { ...stay, schedule: { type: "day", date: "2026-09-13", endDate: "2026-09-14" },
      selection: { status: "selected", accommodation: { provider: "synthetic", providerItemId: "hotel", place, selectedAt: "2026-09-12T08:00:00Z", checkInDate: "2026-09-13", checkOutDate: "2026-09-14",
        sources: [{ id: "hotel-source", kind: "accommodation", provider: "synthetic", sourceId: "hotel", retrievedAt: "2026-09-12T07:00:00Z", confidence: "observed" }] } } };
    const validate = () => requestTrip(request, [selected]);
    if (status === "rejected") expect(validate).toThrow("Rejected assumption still supports an item");
    else expect(validate).not.toThrow();
  });
  it.each(["unconfirmed", "confirmed", "rejected"] as const)("preserves transport schedule/place/selection: %s", (status) => {
    const selected = requestRailItem();
    for (const field of ["schedule", "place", "selection"] as const) {
      const request = assumptionRequest(selected.id, field, status);
      expect(() => requestTrip(request, [{ ...selected, schedule: { type: "unscheduled" }, detail: { status: "unresolved" } }])).not.toThrow();
      const validate = () => requestTrip(request, [selected]);
      if (status === "rejected") expect(validate).toThrow("Rejected assumption still supports an item");
      else expect(validate).not.toThrow();
    }
  });
  it("rejects an inapplicable reference through request validation and atomic Proposal without changing Trip", () => {
    const trip = requestTrip(undefined, [activity]);
    const before = structuredClone(trip);
    const request = assumptionRequest(activity.id, "selection", "unconfirmed");
    expect(() => validateTripRequest(request, trip.items)).toThrow("Activity assumption must affect schedule or place");
    expect(() => applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "仮置き", patches: [{ type: "request", request }] })).toThrow("Activity assumption must affect schedule or place");
    expect(trip).toEqual(before);
  });
});
