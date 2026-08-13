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
    { station_name: "大阪", event: "着", route_time_minutes: 1_080 },
    { station_name: "京都", event: "着", route_time_minutes: 1_120 },
  ],
};
const position: TrainPosition = {
  serviceUid: train.service_uid,
  trainNo: train.train_no,
  serviceType: train.service_type,
  routeMeter: 100,
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
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
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

  it("treats a model-requested early-morning time as the previous operating day", async () => {
    const setRouteTime = vi.fn();
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
                input: { routeTimeMinutes: 30 },
              },
            },
          ],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "表示時刻を24時30分に変更しました。" }],
        },
        stopReason: "end_turn",
      });

    await runBedrockViewerAgent(
      "深夜の時間にして",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_000,
        setRouteTime,
        focusTrain: vi.fn(),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(setRouteTime).toHaveBeenCalledWith(1_470);
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
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(focusTrain).not.toHaveBeenCalled();
  });

  it("queries the saved daily congestion peak requested by Bedrock", async () => {
    const queryDailyAnalysis = vi.fn(async () => ({
      serviceDate: "2026-07-29",
      sampleCount: 64,
      observationStart: "2026-07-29T00:00:00+00:00",
      observationEnd: "2026-07-29T08:15:00+00:00",
      peak: {
        collectedAt: "2026-07-29T08:15:00+00:00",
        totalCongestion: 3_934,
        trainCount: 38,
        carCount: 291,
        topTrains: [],
      },
      hourly: [],
      topLines: [],
      topTrains: [],
      unmatchedTrainCount: 0,
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
                name: "query_daily_congestion_analysis",
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
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: queryDailyAnalysis,
        queryTrainDelayAnalysis: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(queryDailyAnalysis).toHaveBeenCalledWith("2026-07-29");
    expect(result).toContain("3,934");
  });

  it("queries saved train delays requested by Bedrock", async () => {
    const queryTrainDelayAnalysis = vi.fn(async () => ({
      serviceDate: "2026-07-29",
      sampleCount: 60,
      observationStart: "2026-07-29T08:00:00+00:00",
      observationEnd: "2026-07-29T08:59:00+00:00",
      latest: {
        collectedAt: "2026-07-29T08:59:00+00:00",
        sourceCount: 26,
        failureCount: 0,
        observedTrainCount: 300,
        delayedTrainCount: 1,
        totalDelayMinutes: 8,
        maximumDelayMinutes: 8,
        topTrains: [],
      },
      peak: null,
      hourly: [],
      topTrains: [],
      unmatchedTrainCount: 0,
    }));
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "delays",
                name: "query_train_delay_analysis",
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
          content: [{ text: "現在1本、最大8分の遅れです。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "現在遅れている列車は？",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(queryTrainDelayAnalysis).toHaveBeenCalledWith("2026-07-29");
    expect(result).toContain("最大8分");
  });

  it("searches arrivals in a 30 minute window without changing display time", async () => {
    const setRouteTime = vi.fn();
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "arrivals",
                name: "search_train_arrivals",
                input: {
                  query: "京都に着く特急",
                  targetTimeMinutes: 1_110,
                },
              },
            },
          ],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "18時40分着のはるか16号があります。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "18時30分ごろ京都に着く特急はありますか",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_000,
        setRouteTime,
        focusTrain: vi.fn(),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(setRouteTime).not.toHaveBeenCalled();
    expect(result).toContain("はるか16号");
    expect(JSON.stringify(converse.mock.calls[1]?.[0])).toContain(
      '"arrivalTimeMinutes":1120',
    );
    expect(JSON.stringify(converse.mock.calls[1]?.[0])).toContain(
      '"windowMinutes":30',
    );
  });

  it("changes weather and optional map layers", async () => {
    const setWeather = vi.fn();
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
          content: [{ text: "雨にして目的地アーチを表示しました。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "雨にして目的地アーチを表示して",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setWeather,
        setLayerVisibility,
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(setWeather).toHaveBeenCalledWith("rain");
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

  it("relays a representative timetable search without treating it as a focusable live train", async () => {
    const searchRepresentativeTimetable = vi.fn(async () => ({
      timetableKind: "weekday" as const,
      serviceDate: "2026-07-31",
      mode: "arrivals" as const,
      targetTimeMinutes: 600,
      totalMatchCount: 1,
      matches: [
        {
          trainNumber: "101M",
          serviceType: "特急",
          trainName: "はるか16号",
          origin: "関西空港",
          destination: "京都",
          matchingStops: [
            { stationName: "大阪", event: "着", routeTimeMinutes: 600 },
          ],
        },
      ],
    }));
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{
            toolUse: {
              toolUseId: "representative",
              name: "search_representative_timetable",
              input: {
                timetableKind: "weekday",
                query: "平日の10時ごろ大阪に着く特急",
                mode: "arrivals",
                targetTimeMinutes: 600,
              },
            },
          }],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "代表日の計画ダイヤでは、はるか16号があります。" }],
        },
        stopReason: "end_turn",
      });

    await runBedrockViewerAgent(
      "平日の10時ごろ大阪に着く特急は？",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 600,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchRepresentativeTimetable,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchRepresentativeTimetable).toHaveBeenCalledWith({
      timetableKind: "weekday",
      query: "平日の10時ごろ大阪に着く特急",
      mode: "arrivals",
      targetTimeMinutes: 600,
      limit: 5,
    });
  });

  it("searches a destination from the browser-selected nearest station and focuses it", async () => {
    let routeTime = 1_388;
    const focusTrain = vi.fn(() => true);
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "大阪",
      distanceMeters: 420,
      results: [{
        train,
        originStation: "大阪",
        destinationStation: "京都",
        departureTimeMinutes: 1_395,
        arrivalTimeMinutes: 1_425,
      }],
    }));
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{
            toolUse: {
              toolUseId: "route",
              name: "search_direct_routes",
              // モデルが現在時刻を誤っても、ブラウザの表示時刻を検索に使う。
              input: { destinationStation: "京都", departureTimeMinutes: 833 },
            },
          }],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{
            toolUse: {
              toolUseId: "time",
              name: "set_display_time",
              // 経路検索後の時刻変更要求は、モデルの値にかかわらず無視する。
              input: { routeTimeMinutes: 833 },
            },
          }],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{
            toolUse: {
              toolUseId: "focus",
              name: "focus_train",
              input: { serviceUid: train.service_uid },
            },
          }],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "最寄りの大阪駅から京都駅までご案内します。" }],
        },
        stopReason: "end_turn",
      });

    await runBedrockViewerAgent(
      "京都に行きたい",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => routeTime,
        setRouteTime: (value) => { routeTime = value; },
        focusTrain,
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith({
      destinationStation: "京都",
      departureTimeMinutes: 1_388,
    });
    expect(routeTime).toBe(1_388);
    expect(focusTrain).toHaveBeenCalledWith(train.service_uid);
    const secondRequest = JSON.stringify(converse.mock.calls[1]?.[0]);
    expect(secondRequest).toContain('"originStation":"大阪"');
    expect(secondRequest).toContain('"distanceMeters":420');
  });
});
