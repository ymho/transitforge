// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Train } from "@raiquora/train/train";
import { configureTrainSelection } from "./train-selection-controller";

describe("latest train hit selection", () => {
  it("opens the current train rather than stale worker-backed features", () => {
    let click: (event: { point: { x: number; y: number } }) => void = () => {};
    const queryRenderedFeatures = vi.fn(() => [{ properties: { service_uid: "stale" } }]);
    const map = {
      on: (name: string, ...args: unknown[]) => { if (name === "click") click = args[0] as typeof click; },
      queryRenderedFeatures, stop: vi.fn(),
    } as unknown as MapboxMap;
    const details = document.createElement("section"); details.hidden = true;
    const focused = vi.fn();
    const latestHit = vi.fn(() => "current");
    const train: Train = { service_uid: "current", train_no: "1A", service_type: "普通", train_name: "", origin_station: "大阪", destination_station: "京都", stops: [] };
    const controller = configureTrainSelection(map, [train], {
      setFocusedServiceUid: focused, trainServiceUidAt: latestHit,
      congestionBarServiceUidAt: () => undefined,
    }, new Map(), new Map(), {
      details, close: document.createElement("button"), title: document.createElement("div"),
      stopping: document.createElement("span"), delay: document.createElement("span"),
      stops: document.createElement("ol"), coupledTabs: document.createElement("div"),
    });
    controller.updateTracking([]);
    click({ point: { x: 40, y: 50 } });
    expect(latestHit).toHaveBeenCalledWith({ x: 40, y: 50 });
    expect(focused).toHaveBeenLastCalledWith("current");
    expect(details.hidden).toBe(false);
    expect(queryRenderedFeatures).not.toHaveBeenCalled();
  });
});
