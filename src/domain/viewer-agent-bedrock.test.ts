import { describe, expect, it, vi } from "vitest";

import type { Train } from "../data/train-index";
import type { TrainPosition } from "./train-position";
import {
  currentDateInJapan,
  runBedrockViewerAgent,
} from "./viewer-agent-bedrock";

const train: Train = {
  service_uid: "service-1",
  train_no: "101M",
  service_type: "特急",
  train_name: "はるか16号",
  origin_station: "関西空港",
  destination_station: "京都",
  path_id: "path",
  stops: [
    { station_name: "大阪", route_time_minutes: 1_080 },
    { station_name: "京都", route_time_minutes: 1_120 },
  ],
};
const position: TrainPosition = {
  serviceUid: train.service_uid,
  trainNo: train.train_no,
  serviceType: train.service_type,
  coordinate: [135.5, 34.7],
  bearingRadians: 0,
};

describe("Bedrock viewer agent", () => {
  it("changes time, searches at that time, and focuses only a search result", async () => {
    let routeTime = 1_000;
    const focusTrain = vi.fn(() => true);
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "time",
                name: "set_display_time",
                // モデルが暗算を誤っても、元の「18時20分」を優先する。
                input: { routeTimeMinutes: 1_080 },
              },
            },
          ],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "search",
                name: "search_trains",
                input: { query: "京都へ向かう特急" },
              },
            },
          ],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "focus",
                name: "focus_train",
                input: { serviceUid: "service-1" },
              },
            },
          ],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "18時20分のはるか16号へ移動しました。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "18時20分に京都へ向かう特急を見せて",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => routeTime,
        setRouteTime: (value) => {
          routeTime = value;
        },
        focusTrain,
        setWeather: vi.fn(),
        setSceneMode: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionPeak: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(routeTime).toBe(1_100);
    expect(focusTrain).toHaveBeenCalledWith("service-1");
    expect(result).toContain("はるか16号");
    const thirdRequest = converse.mock.calls[2]?.[0];
    expect(JSON.stringify(thirdRequest)).toContain('"serviceUid":"service-1"');
  });

  it("does not focus a service identifier that was not returned by search", async () => {
    const focusTrain = vi.fn(() => true);
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "focus",
                name: "focus_train",
                input: { serviceUid: "invented" },
              },
            },
          ],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "列車を選択できませんでした。" }],
        },
        stopReason: "end_turn",
      });

    await runBedrockViewerAgent(
      "列車を見せて",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain,
        setWeather: vi.fn(),
        setSceneMode: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionPeak: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(focusTrain).not.toHaveBeenCalled();
  });

  it("queries the saved daily congestion peak requested by Bedrock", async () => {
    const queryDailyPeak = vi.fn(async () => ({
      serviceDate: "2026-07-29",
      sampleCount: 64,
      peak: {
        collectedAt: "2026-07-29T08:15:00+00:00",
        sourceUpdatedAt: "2026-07-29T08:14:50+00:00",
        totalCongestion: 3_934,
        trainCount: 38,
        carCount: 291,
        topTrains: [{ trainNumber: "1655H", totalCongestion: 240 }],
      },
    }));
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "history",
                name: "query_daily_congestion_peak",
                input: { serviceDate: "2026-07-29" },
              },
            },
          ],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "ピークは17時15分、合計3,934でした。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "今日の混雑のピークは？",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setWeather: vi.fn(),
        setSceneMode: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionPeak: queryDailyPeak,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(queryDailyPeak).toHaveBeenCalledWith("2026-07-29");
    expect(result).toContain("3,934");
  });

  it("changes weather, scene mode, and optional map layers", async () => {
    const setWeather = vi.fn();
    const setSceneMode = vi.fn();
    const setLayerVisibility = vi.fn();
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "weather",
                name: "set_weather",
                input: { weather: "rain" },
              },
            },
            {
              toolUse: {
                toolUseId: "scene",
                name: "set_scene_mode",
                input: { sceneMode: "model" },
              },
            },
            {
              toolUse: {
                toolUseId: "layer",
                name: "set_layer_visibility",
                input: { layer: "destination_arcs", visible: true },
              },
            },
          ],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "雨の模型モードで目的地アーチを表示しました。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "雨の模型モードにして目的地アーチを表示して",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setWeather,
        setSceneMode,
        setLayerVisibility,
        queryDailyCongestionPeak: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(setWeather).toHaveBeenCalledWith("rain");
    expect(setSceneMode).toHaveBeenCalledWith("model");
    expect(setLayerVisibility).toHaveBeenCalledWith(
      "destination_arcs",
      true,
    );
    expect(result).toContain("目的地アーチ");
  });

  it("formats the current date in Japan independently of the browser timezone", () => {
    expect(currentDateInJapan(new Date("2026-07-29T15:30:00Z"))).toBe(
      "2026-07-30",
    );
  });
});
