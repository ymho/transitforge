import { describe, expect, it, vi } from "vitest";

import type { Train } from "../data/train-index";
import { createLocalViewerAgent } from "./viewer-agent-local";

const train: Train = {
  service_uid: "direct",
  train_no: "101M",
  service_type: "普通",
  train_name: "",
  origin_station: "向日町",
  destination_station: "京都",
  stops: [
    { station_name: "向日町", event: "発", route_time_minutes: 1_395 },
    { station_name: "京都", event: "着", route_time_minutes: 1_403 },
  ],
};

describe("local viewer agent", () => {
  it("searches direct routes at the current time without moving the clock", async () => {
    const setRouteTime = vi.fn();
    const focusTrain = vi.fn(() => false);
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "向日町",
      results: [{
        train,
        originStation: "向日町",
        destinationStation: "京都",
        departureTimeMinutes: 1_395,
        arrivalTimeMinutes: 1_403,
      }],
    }));
    const handlePrompt = createLocalViewerAgent({
      trains: [train],
      getPositions: () => [],
      getRouteTime: () => 1_388,
      setRouteTime,
      focusTrain,
      setWeather: vi.fn(),
      setLayerVisibility: vi.fn(),
      searchDirectRoutes,
      maximumRouteTime: 1_800,
    });

    const response = await handlePrompt("向日町駅から京都駅に行きたい");

    expect(searchDirectRoutes).toHaveBeenCalledWith({
      originStation: "向日町",
      destinationStation: "京都",
      departureTimeMinutes: 1_388,
    });
    expect(setRouteTime).not.toHaveBeenCalled();
    expect(focusTrain).toHaveBeenCalledWith("direct");
    expect(response).toContain("23時15分 向日町発");
    expect(response).toContain("23時23分 京都着");
    expect(response).toContain("経路のみ案内します");
  });
});
