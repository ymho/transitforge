// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { multiCityTrip } from "../../../../modules/trip/domain/trip-places.fixture";
import { renderTripTravelMode, tripTravelModeProjection } from "./trip-travel-mode";

describe("Trip travel mode", () => {
  it("labels non-current trips as a read-only schedule preview", () => {
    const trip = multiCityTrip(), before = structuredClone(trip);
    const root = renderTripTravelMode({ trip, now: new Date("2026-09-01T00:00:00Z"), back: vi.fn(), ask: vi.fn(), focus: vi.fn() });
    expect(root.textContent).toContain("プレビュー"); expect(root.textContent).toContain("旅行状態、完了実績、予約は変更されません");
    expect(trip).toEqual(before);
  });

  it("renders only the server-bounded in-trip facts and keeps claims qualified", () => {
    const f = inTripFixture(); const focus = vi.fn(), ask = vi.fn();
    const view = tripTravelModeProjection(f.trip, new Date(f.now.at), f.snapshot);
    expect(view.mode).toBe("live"); expect(view.current.length + view.next.length).toBeGreaterThan(0);
    const root = renderTripTravelMode({ trip: f.trip, now: new Date(f.now.at), snapshot: f.snapshot, back: vi.fn(), ask, focus });
    expect(root.textContent).toContain("予定上の現在"); expect(root.textContent).toContain("実際の乗車・到着・訪問を示すものではありません");
    expect(root.textContent).toContain("観測");
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "この旅についてAIに相談")!.click();
    expect(ask).toHaveBeenCalledWith("この旅の現在と次の予定について相談したい");
  });

  it("rejects another Trip or revision snapshot instead of displaying it", () => {
    const f = inTripFixture();
    expect(() => tripTravelModeProjection({ ...f.trip, revision: f.trip.revision + 1 }, new Date(f.now.at), f.snapshot)).toThrow(/Stale/);
  });
});
