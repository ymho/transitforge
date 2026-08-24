import { describe, expect, it, vi } from "vitest";

import type { Train } from "../data/train-index";
import type { TrainPosition } from "./train-position";
import type { UserProfile } from "./travel-profile";
import type {
  ViewerAgentResponse,
  ViewerAgentRichResponse,
} from "./viewer-agent-response";
import {
  currentServiceDateInJapan,
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
        getCurrentDate: () => new Date("2026-08-14T12:00:00+09:00"),
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

  it("uses the 4:00 JST operating-day boundary for the current service date", () => {
    expect(
      currentServiceDateInJapan(new Date("2026-07-29T18:59:59Z")),
    ).toBe("2026-07-29");
    expect(
      currentServiceDateInJapan(new Date("2026-07-29T19:00:00Z")),
    ).toBe("2026-07-30");
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
              input: {
                destinationStation: "京都",
                departureTimeMinutes: 833,
                originStation: "&quot;現在地から最寄り駅&quot;",
              },
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
        getCurrentDate: () => new Date("2026-08-14T23:08:00+09:00"),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith({
      destinationStation: "京都",
      departureTimeMinutes: 1_388,
      departureDate: "2026-08-14",
      serviceDate: "2026-08-14",
      transferPace: "standard",
      rankingPreference: "balanced",
      maxTransfers: 3,
    });
    expect(routeTime).toBe(1_388);
    expect(focusTrain).toHaveBeenCalledWith(train.service_uid);
    expect(converse).toHaveBeenCalledTimes(1);
  });

  it("formats after-midnight direct-route times without model arithmetic", async () => {
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "向日町",
      results: [{
        train: {
          ...train,
          train_no: "538C",
          service_type: "普通",
          train_name: "",
        },
        originStation: "向日町",
        destinationStation: "京都",
        departureTimeMinutes: 1_475,
        arrivalTimeMinutes: 1_483,
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
              input: { destinationStation: "京都", departureTimeMinutes: 885 },
            },
          }],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{
            text: "向日町を14時45分に発車し、14時53分に到着します。",
          }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "京都に行きたい",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 1_463,
        getCurrentDate: () => new Date("2026-08-14T00:23:00+09:00"),
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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
      departureTimeMinutes: 1_463,
      departureDate: "2026-08-14",
      serviceDate: "2026-08-13",
      transferPace: "standard",
      rankingPreference: "balanced",
      maxTransfers: 3,
    });
    const rich = requireRichResponse(result);
    expect(rich.journeyPlan.journeys[0]).toMatchObject({
      departureTimeMinutes: 1_475,
      arrivalTimeMinutes: 1_483,
    });
  });

  it("uses stations parsed from the prompt when the model omits the origin", async () => {
    const routeTrain: Train = {
      ...train,
      service_type: "普通",
      train_name: "",
      train_no: "538C",
      stops: [
        { station_name: "西大路", event: "発", route_time_minutes: 1_480 },
        { station_name: "京都", event: "着", route_time_minutes: 1_483 },
      ],
    };
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "西大路駅",
      results: [{
        train: routeTrain,
        originStation: "西大路駅",
        destinationStation: "京都駅",
        departureTimeMinutes: 1_480,
        arrivalTimeMinutes: 1_483,
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
              input: { destinationStation: "京都", departureTimeMinutes: 1_463 },
            },
          }],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "京都まで案内します。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "西大路から京都に行きたい",
      {
        trains: [routeTrain],
        getPositions: () => [],
        getRouteTime: () => 1_463,
        getCurrentDate: () => new Date("2026-08-14T00:23:00+09:00"),
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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
      originStation: "西大路",
      destinationStation: "京都",
      departureTimeMinutes: 1_463,
      departureDate: "2026-08-14",
      serviceDate: "2026-08-13",
      transferPace: "standard",
      rankingPreference: "balanced",
      maxTransfers: 3,
    });
    const rich = requireRichResponse(result);
    expect(rich.text).toContain("西大路駅から京都駅への経路候補");
    expect(rich.text).not.toContain("駅駅");
  });

  it("does not treat the temporal phrase いまから as the route separator", async () => {
    const airportRoute: Train = {
      ...train,
      service_uid: "himeji-airport",
      origin_station: "姫路",
      destination_station: "関西空港",
      stops: [
        { station_name: "姫路", event: "発", route_time_minutes: 750 },
        { station_name: "関西空港", event: "着", route_time_minutes: 870 },
      ],
    };
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "姫路",
      results: [],
      journeys: [],
    }));
    const converse = vi.fn().mockResolvedValueOnce({
      message: {
        role: "assistant",
        content: [{
          toolUse: {
            toolUseId: "route",
            name: "search_direct_routes",
            input: {
              originStation: "姫路",
              destinationStation: "姫路",
              departureTimeMinutes: 742,
            },
          },
        }],
      },
      stopReason: "tool_use",
    });

    const result = await runBedrockViewerAgent(
      "いまから姫路から関西空港にいきたい",
      {
        trains: [airportRoute],
        getTrains: () => [],
        getPositions: () => [],
        getRouteTime: () => 742,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith(expect.objectContaining({
      originStation: "姫路",
      destinationStation: "関西空港",
      departureTimeMinutes: 742,
    }));
    expect(result).toBe(
      "12時22分以降に姫路駅から関西空港駅へ行く経路は見つかりませんでした。",
    );
  });

  it("formats a one-transfer journey with its station and wait time", async () => {
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "嵯峨嵐山",
      results: [],
      journeys: [{
        departureTimeMinutes: 602,
        arrivalTimeMinutes: 710,
        transferCount: 1,
        legs: [
          {
            serviceUid: "first",
            trainNumber: "1230M",
            serviceType: "普通",
            trainName: "",
            originStation: "嵯峨嵐山",
            destinationStation: "京都",
            departureTimeMinutes: 602,
            arrivalTimeMinutes: 619,
          },
          {
            serviceUid: "second",
            trainNumber: "1019M",
            serviceType: "特急",
            trainName: "はるか19号",
            originStation: "京都",
            destinationStation: "関西空港",
            departureTimeMinutes: 630,
            arrivalTimeMinutes: 710,
          },
        ],
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
              input: {
                originStation: "嵯峨嵐山",
                destinationStation: "関西空港",
                departureTimeMinutes: 600,
              },
            },
          }],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "経路を案内します。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "8/15の7:00に嵯峨嵐山から関西空港に行きたい",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 600,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
        getCurrentDate: () => new Date("2026-08-14T12:00:00+09:00"),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith({
      originStation: "嵯峨嵐山",
      destinationStation: "関西空港",
      departureTimeMinutes: 420,
      departureDate: "2026-08-15",
      serviceDate: "2026-08-15",
      transferPace: "standard",
      rankingPreference: "balanced",
      maxTransfers: 3,
    });
    const rich = requireRichResponse(result);
    expect(rich.text).toContain("8月15日の");
    expect(rich.journeyPlan.journeys[0]?.legs.map((leg) => leg.trainNumber)).toEqual([
      "1230M",
      "1019M",
    ]);
    expect(
      (rich.journeyPlan.journeys[0]?.legs[1]?.departureTimeMinutes ?? 0) -
      (rich.journeyPlan.journeys[0]?.legs[0]?.arrivalTimeMinutes ?? 0),
    ).toBe(11);
  });

  it("answers a train-name follow-up from the previous journey without another model call", async () => {
    const converse = vi.fn();
    const result = await runBedrockViewerAgent(
      "特急やくもは？",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 420,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        getPreviousJourneyPlan: () => ({
          departureDate: "2026-08-15",
          originStation: "京都",
          destinationStation: "出雲市",
          journeys: [{
            departureTimeMinutes: 483,
            arrivalTimeMinutes: 737,
            transferCount: 1,
            legs: [
              {
                serviceUid: "nozomi-99",
                trainNumber: "99A",
                serviceType: "新幹線",
                trainName: "のぞみ",
                originStation: "京都",
                destinationStation: "岡山",
                departureTimeMinutes: 483,
                arrivalTimeMinutes: 543,
              },
              {
                serviceUid: "yakumo-5",
                trainNumber: "1005M",
                serviceType: "特急",
                trainName: "やくも5号",
                originStation: "岡山",
                destinationStation: "出雲市",
                departureTimeMinutes: 553,
                arrivalTimeMinutes: 737,
              },
            ],
          }],
        }),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    const rich = requireRichResponse(result);
    expect(rich.text).toContain("岡山駅を9時13分に発車する特急 やくも5号");
    expect(rich.journeyPlan.destinationStation).toBe("出雲市");
    expect(converse).not.toHaveBeenCalled();
  });

  it("applies a named-train wish remembered before the route request", async () => {
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "大阪",
      requiredTrainNames: ["はるか"],
      results: [],
      journeys: [{
        departureTimeMinutes: 1_080,
        arrivalTimeMinutes: 1_120,
        transferCount: 0,
        legs: [{
          serviceUid: train.service_uid,
          trainNumber: train.train_no,
          serviceType: train.service_type,
          trainName: train.train_name,
          originStation: "大阪",
          destinationStation: "京都",
          departureTimeMinutes: 1_080,
          arrivalTimeMinutes: 1_120,
        }],
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
              input: {
                originStation: "大阪",
                destinationStation: "京都",
                departureTimeMinutes: 1_070,
              },
            },
          }],
        },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [{ text: "経路を案内します。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "大阪から京都へ行きたい",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 1_070,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(() => true),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
        getPendingJourneyGuidance: () => ({
          excludedServiceTypes: ["新幹線"],
          excludedTrainNames: [],
          excludedTrainNumbers: [],
          requiredServiceTypes: [],
          requiredTrainNames: ["はるか"],
          requiredTrainNumbers: [],
          allowedServiceTypes: [],
        }),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith(expect.objectContaining({
      originStation: "大阪",
      destinationStation: "京都",
      excludedServiceTypes: ["新幹線"],
      requiredTrainNames: ["はるか"],
    }));
    expect(requireRichResponse(result).journeyPlan.requiredTrainNames)
      .toEqual(["はるか"]);
  });

  it("reruns the previous journey without Shinkansen from a follow-up", async () => {
    const converse = vi.fn();
    const focusTrain = vi.fn(() => true);
    const searchDirectRoutes = vi.fn(async () => ({
      serviceDate: "2026-08-15",
      departureDate: "2026-08-15",
      originStation: "高槻",
      excludedServiceTypes: ["新幹線"],
      results: [],
      journeys: [{
        departureTimeMinutes: 805,
        arrivalTimeMinutes: 895,
        transferCount: 1,
        legs: [
          {
            serviceUid: "rapid-takatsuki-yasu",
            trainNumber: "3450M",
            serviceType: "新快速",
            trainName: "",
            originStation: "高槻",
            destinationStation: "野洲",
            departureTimeMinutes: 805,
            arrivalTimeMinutes: 855,
          },
          {
            serviceUid: "local-yasu-maibara",
            trainNumber: "785T",
            serviceType: "普通",
            trainName: "",
            originStation: "野洲",
            destinationStation: "米原",
            departureTimeMinutes: 862,
            arrivalTimeMinutes: 895,
          },
        ],
      }],
    }));

    const result = await runBedrockViewerAgent(
      "新幹線を使いたくない",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 900,
        setRouteTime: vi.fn(),
        focusTrain,
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
        getPreviousJourneyPlan: () => ({
          departureDate: "2026-08-15",
          serviceDate: "2026-08-15",
          originStation: "高槻",
          destinationStation: "米原",
          transferPace: "relaxed",
          rankingPreference: "balanced",
          maxTransfers: 3,
          searchTimeMinutes: 798,
          journeys: [{
            departureTimeMinutes: 798,
            arrivalTimeMinutes: 846,
            transferCount: 1,
            legs: [{
              serviceUid: "rapid-takatsuki-kyoto",
              trainNumber: "3448M",
              serviceType: "新快速",
              trainName: "",
              originStation: "高槻",
              destinationStation: "京都",
              departureTimeMinutes: 798,
              arrivalTimeMinutes: 811,
            }, {
              serviceUid: "hikari-500",
              trainNumber: "500A",
              serviceType: "新幹線",
              trainName: "ひかり",
              originStation: "京都",
              destinationStation: "米原",
              departureTimeMinutes: 827,
              arrivalTimeMinutes: 846,
            }],
          }],
        }),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith({
      originStation: "高槻",
      destinationStation: "米原",
      departureTimeMinutes: 798,
      serviceDate: "2026-08-15",
      departureDate: "2026-08-15",
      transferPace: "relaxed",
      rankingPreference: "balanced",
      maxTransfers: 3,
      excludedServiceTypes: ["新幹線"],
    });
    const rich = requireRichResponse(result);
    expect(rich.text).toContain("新幹線を使わない条件で");
    expect(rich.journeyPlan.excludedServiceTypes).toEqual(["新幹線"]);
    expect(rich.journeyPlan.journeys[0]?.legs).toHaveLength(2);
    expect(rich.journeyPlan.journeys[0]?.legs).not.toContainEqual(
      expect.objectContaining({ serviceType: "新幹線" }),
    );
    expect(focusTrain).toHaveBeenCalledWith("rapid-takatsuki-yasu");
    expect(converse).not.toHaveBeenCalled();
  });

  it("carries previous exclusions into a named-train follow-up", async () => {
    const converse = vi.fn();
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "岡山",
      results: [],
      journeys: [{
        departureTimeMinutes: 600,
        arrivalTimeMinutes: 720,
        transferCount: 0,
        legs: [{
          serviceUid: "ordinary-1",
          trainNumber: "101M",
          serviceType: "普通",
          trainName: "",
          originStation: "岡山",
          destinationStation: "出雲市",
          departureTimeMinutes: 600,
          arrivalTimeMinutes: 720,
        }],
      }],
    }));
    const result = await runBedrockViewerAgent(
      "特急やくもを避けて",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 600,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(() => true),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
        getPreviousJourneyPlan: () => ({
          serviceDate: "2026-08-15",
          originStation: "岡山",
          destinationStation: "出雲市",
          transferPace: "standard",
          rankingPreference: "balanced",
          maxTransfers: 3,
          searchTimeMinutes: 590,
          excludedServiceTypes: ["新幹線"],
          journeys: [{
            departureTimeMinutes: 595,
            arrivalTimeMinutes: 700,
            transferCount: 0,
            legs: [{
              serviceUid: "yakumo-5",
              trainNumber: "1005M",
              serviceType: "特急",
              trainName: "やくも5号",
              originStation: "岡山",
              destinationStation: "出雲市",
              departureTimeMinutes: 595,
              arrivalTimeMinutes: 700,
            }],
          }],
        }),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith(expect.objectContaining({
      originStation: "岡山",
      destinationStation: "出雲市",
      departureTimeMinutes: 590,
      excludedServiceTypes: ["新幹線"],
      excludedTrainNames: ["やくも"],
    }));
    const rich = requireRichResponse(result);
    expect(rich.journeyPlan.excludedServiceTypes).toEqual(["新幹線"]);
    expect(rich.journeyPlan.excludedTrainNames).toEqual(["やくも"]);
    expect(converse).not.toHaveBeenCalled();
  });

  it("reruns the previous route to include a requested named train", async () => {
    const yakumoTrain: Train = {
      ...train,
      service_uid: "yakumo-5",
      train_no: "1005M",
      service_type: "特急",
      train_name: "やくも5号",
      origin_station: "岡山",
      destination_station: "出雲市",
    };
    const converse = vi.fn();
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "京都",
      requiredTrainNames: ["やくも"],
      results: [],
      journeys: [{
        departureTimeMinutes: 480,
        arrivalTimeMinutes: 720,
        transferCount: 1,
        legs: [{
          serviceUid: "kyoto-okayama",
          trainNumber: "99A",
          serviceType: "新幹線",
          trainName: "のぞみ99号",
          originStation: "京都",
          destinationStation: "岡山",
          departureTimeMinutes: 480,
          arrivalTimeMinutes: 540,
        }, {
          serviceUid: "yakumo-5",
          trainNumber: "1005M",
          serviceType: "特急",
          trainName: "やくも5号",
          originStation: "岡山",
          destinationStation: "出雲市",
          departureTimeMinutes: 553,
          arrivalTimeMinutes: 720,
        }],
      }],
    }));
    const result = await runBedrockViewerAgent(
      "やくもにのりたい",
      {
        trains: [train, yakumoTrain],
        getPositions: () => [],
        getRouteTime: () => 470,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(() => true),
        setWeather: vi.fn(),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
        getPreviousJourneyPlan: () => ({
          serviceDate: "2026-08-15",
          originStation: "京都",
          destinationStation: "出雲市",
          transferPace: "standard",
          rankingPreference: "balanced",
          maxTransfers: 3,
          searchTimeMinutes: 470,
          journeys: [{
            departureTimeMinutes: 475,
            arrivalTimeMinutes: 700,
            transferCount: 1,
            legs: [],
          }],
        }),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith(expect.objectContaining({
      originStation: "京都",
      destinationStation: "出雲市",
      departureTimeMinutes: 470,
      requiredTrainNames: ["やくも"],
    }));
    const rich = requireRichResponse(result);
    expect(rich.text).toContain("やくもを利用する条件");
    expect(rich.journeyPlan.requiredTrainNames).toEqual(["やくも"]);
    expect(converse).not.toHaveBeenCalled();
  });

  it("combines an overnight trip with outbound and return rail routes", async () => {
    const izumoTrain: Train = {
      ...train,
      origin_station: "京都",
      destination_station: "出雲市",
      stops: [{ station_name: "出雲市", event: "着", route_time_minutes: 780 }],
    };
    const searchDirectRoutes = vi.fn()
      .mockResolvedValueOnce({ originStation: "京都", serviceDate: "2026-08-17", results: [{
        train: izumoTrain, originStation: "京都", destinationStation: "出雲市",
        departureTimeMinutes: 480, arrivalTimeMinutes: 780,
      }] })
      .mockResolvedValueOnce({ originStation: "出雲市", serviceDate: "2026-08-18", results: [{
        train: { ...izumoTrain, origin_station: "出雲市", destination_station: "京都" },
        originStation: "出雲市", destinationStation: "京都",
        departureTimeMinutes: 600, arrivalTimeMinutes: 900,
      }] });
    const converse = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "stay", name: "search_accommodations", input: {
          destination: "出雲", checkInDate: "2026-08-17", checkOutDate: "2026-08-18",
        },
      } }] },
      stopReason: "tool_use",
    });

    const result = await runBedrockViewerAgent(
      "明日、出雲で1泊して観光したい",
      {
        trains: [izumoTrain], getPositions: () => [], getRouteTime: () => 1_200,
        getCurrentDate: () => new Date("2026-08-16T21:00:00+09:00"),
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setWeather: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        searchAccommodations: vi.fn(async () => ({ accommodations: [{
          name: "出雲の宿", checkInDate: "2026-08-17", checkOutDate: "2026-08-18",
          bookingUrl: "https://example.com/stay",
        }] })),
        getUserProfile: () => ({
          home: { station: "京都", carAvailable: false },
          travelStyle: { transferTolerance: 0.5 },
          transport: { maxTypicalTravelMinutes: 120 },
        } as unknown as UserProfile),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("travelPlan" in result)) throw new Error("旅行プランがありません。");
    expect(result.travelPlan.outbound.destinationStation).toBe("出雲市");
    expect(result.travelPlan.returning.destinationStation).toBe("京都");
    expect(result.travelPlan.accommodations[0]?.name).toBe("出雲の宿");
    expect(result.text).toContain("普段許容している移動時間より長め");
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(1, expect.objectContaining({
      originStation: "京都", destinationStation: "出雲市",
      departureDate: "2026-08-17",
    }));
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(2, expect.objectContaining({
      originStation: "出雲市", destinationStation: "京都", departureDate: "2026-08-18",
    }));
  });

  it("uses an access station and accommodation area for a landmark stay", async () => {
    const izumoTrain: Train = {
      ...train,
      origin_station: "向日町",
      destination_station: "出雲市",
      stops: [{ station_name: "出雲市", event: "着", route_time_minutes: 780 }],
    };
    const searchDirectRoutes = vi.fn()
      .mockResolvedValueOnce({ originStation: "向日町", results: [] })
      .mockResolvedValueOnce({ originStation: "出雲市", results: [] });
    const searchAccommodations = vi.fn(async () => ({ accommodations: [] }));
    const converse = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "stay", name: "search_accommodations", input: {
          destination: "出雲大社", checkInDate: "2026-08-17", checkOutDate: "2026-08-18",
        },
      } }] },
      stopReason: "tool_use",
    });

    await runBedrockViewerAgent(
      "明日、出雲大社に1泊して観光したい",
      {
        trains: [izumoTrain], getPositions: () => [], getRouteTime: () => 1_200,
        getCurrentDate: () => new Date("2026-08-16T21:00:00+09:00"),
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setWeather: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes, searchAccommodations,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchAccommodations).toHaveBeenCalledWith(expect.objectContaining({
      destination: "出雲",
    }));
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(1, expect.objectContaining({
      destinationStation: "出雲市",
    }));
  });

  it("returns a structured follow-up question without a presentation-specific branch", async () => {
    const converse = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "follow-up", name: "ask_follow_up", input: {
          question: "いつ出発しますか？",
          expectedInput: "departure-date",
          quickReplies: [
            { label: "今日", value: "今日" },
            { label: "明日", value: "明日" },
          ],
          tripContext: { destinationWish: "出雲大社" },
        },
      } }] },
      stopReason: "tool_use",
    });

    const result = await runBedrockViewerAgent(
      "出雲大社へ旅行したい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setWeather: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("conversation" in result)) {
      throw new Error("会話ガイダンスがありません。");
    }
    expect(result.conversation).toMatchObject({
      expectedInput: "departure-date",
      tripContext: { destinationWish: "出雲大社" },
    });
  });

  it("returns a confirmable proposal for a rental-car movement", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "movement-id" });
    const converse = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "update",
        name: "propose_trip_update",
        input: {
          summary: "駅から宿までレンタカー移動を追加",
          patches: [{
            type: "addMovement",
            mode: "rental-car",
            origin: "出雲市駅",
            destination: "宿",
            afterId: "outbound",
          }],
        },
      } }] },
      stopReason: "tool_use",
    });

    const result = await runBedrockViewerAgent(
      "駅からレンタカーを借りたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setWeather: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), maximumRouteTime: 1_800,
        getTripPlan: () => ({
          version: 1, id: "trip", title: "出雲の旅", destination: "出雲",
          updatedAt: "2026-08-24", items: [{
            id: "outbound", type: "sightseeing",
            place: { name: "出雲大社", provider: "manual" },
          }],
        }),
      },
      converse,
    );

    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("tripPlanUpdate" in result)) {
      throw new Error("旅程変更案がありません。");
    }
    expect(result.tripPlanUpdate.patches[0]).toMatchObject({
      type: "add",
      item: { type: "movement", mode: "rental-car", origin: "出雲市駅" },
    });
    vi.unstubAllGlobals();
  });

  it("persists high-confidence memory and session summary before answering", async () => {
    const remember = vi.fn();
    const update = vi.fn();
    const converse = vi.fn()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [
          { toolUse: { toolUseId: "memory", name: "remember_travel_preference", input: { statement: "早朝は避けたい", confidence: "high" } } },
          { toolUse: { toolUseId: "session", name: "update_conversation_session", input: { scope: "trip", summary: "出雲旅行を相談中", pendingTopics: ["出発日"] } } },
        ] },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ text: "早朝を避けて考えます。" }] },
        stopReason: "end_turn",
      });

    const result = await runBedrockViewerAgent(
      "旅行ではいつも早朝を避けたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setWeather: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), maximumRouteTime: 1_800,
        rememberTravelPreference: remember,
        updateConversationSession: update,
      },
      converse,
    );

    expect(result).toBe("早朝を避けて考えます。");
    expect(remember).toHaveBeenCalledWith("早朝は避けたい", "high");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ scope: "trip", summary: "出雲旅行を相談中" }));
  });
});

function requireRichResponse(result: ViewerAgentResponse): ViewerAgentRichResponse {
  if (typeof result === "string" || !("journeyPlan" in result)) {
    throw new Error(`Expected a rich response but received: ${result}`);
  }
  return result;
}
