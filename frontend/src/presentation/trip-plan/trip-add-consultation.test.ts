import { expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { tripAddConsultation } from "./trip-add-consultation";

it("distinguishes check-in and checkout of the same stay and keeps the following item in context", () => {
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-10-01T00:00:00Z", [
    { id: "hotel", title: "出雲の宿", type: "stay", selection: { status: "unselected" }, schedule: { type: "day", date: "2026-10-05", endDate: "2026-10-06" } },
    { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-06" } },
  ]);
  const days = projectDailyItinerary(trip).days;
  expect(tripAddConsultation(trip, days[0]!.dayKey, "hotel").prompt).toBe("2026-10-05の「出雲の宿」のチェックインの後に追加する予定を相談したい。");
  expect(tripAddConsultation(trip, days[1]!.dayKey, "hotel", "朝食")).toEqual({ itemId: "hotel",
    prompt: "2026-10-06の「出雲の宿」のチェックアウトの後、次の「出雲大社」の前に予定を追加したい。\n希望：朝食" });
  expect(tripAddConsultation(trip, days[0]!.dayKey, "shrine")).toEqual({ prompt: "2026-10-05の旅程に追加する予定を相談したい。" });
  expect(trip.items).toHaveLength(2); expect(trip.revision).toBe(0);
});

it("does not invent a date for unscheduled entries or retain a foreign insertion anchor", () => {
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-10-01T00:00:00Z", [
    { id: "walk", title: "町を歩く", type: "activity", category: "sightseeing", schedule: { type: "unscheduled" } },
  ]);
  expect(tripAddConsultation(trip, "unscheduled", "walk")).toEqual({ itemId: "walk", prompt: "「町を歩く」の後に追加する予定を相談したい。" });
  expect(tripAddConsultation(trip, "unscheduled", "foreign")).toEqual({ prompt: "日時未定の旅程に追加する予定を相談したい。" });
});
