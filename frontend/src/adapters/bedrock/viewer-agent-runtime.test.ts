import { describe, expect, it, vi } from "vitest";

import type { Train } from "@raiquora/train/train";
import type { TrainPosition } from "../../domain/train-position";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import type {
  ViewerAgentResponse,
  ViewerAgentRichResponse,
} from "../../domain/viewer-agent-response";
import {
  currentServiceDateInJapan,
  runViewerAgentRuntime,
  viewerAgentToolDescriptors,
  type BedrockAgentConverse,
} from "./viewer-agent-runtime";

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
  it("exposes the production capability contract for Live Eval", () => {
    const descriptors = viewerAgentToolDescriptors([
      "search_place_media",
      "ask_follow_up",
      "search_accommodations",
      "plan_day_trip",
    ]);

    expect(descriptors.map(({ name }) => name)).toEqual([
      "search_place_media",
      "ask_follow_up",
      "search_accommodations",
      "plan_day_trip",
    ]);
    expect(descriptors[0]?.description).toContain("Evidence:");
    expect(descriptors[1]?.description).toContain("検索Toolが発見 比較する宿");
    expect(descriptors[2]?.description).toContain("宿名を先に決めさせない");
    expect(descriptors[3]?.inputSchema.required).toEqual(["destination", "date", "stayNights"]);
  });

  it("extracts a Bedrock decision summary and never displays the marker", async () => {
    const storedTraces: import("../../usecases/agent/agent-trace").AgentTrace[] = [];
    const storeAgentTrace = vi.fn(async (
      trace: import("../../usecases/agent/agent-trace").AgentTrace,
    ) => { storedTraces.push(trace); });
    const converse: BedrockAgentConverse = async () => ({
      message: { role: "assistant", content: [{
        text: '<decision_summary>{"interpretedGoal":"次の確認事項を案内する","hardConstraints":[],"softPreferences":[],"selectedAction":"answer","unresolvedFacts":[],"reasonCodes":["no_factual_claim_required"]}</decision_summary>日程が決まっていれば教えてください。',
      }] },
      stopReason: "end_turn",
    });
    const result = await runViewerAgentRuntime("次に何を確認すればよい？", {
      trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
      setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
      queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
      storeAgentTrace, maximumRouteTime: 1_800,
    }, converse);

    expect(result).toBe("日程が決まっていれば教えてください。");
    expect(String(result)).not.toContain("decision_summary");
    expect(storedTraces[0]?.events).toContainEqual(
      expect.objectContaining({
        type: "decision_recorded",
        interpretedGoal: "次の確認事項を案内する",
        reasonCodes: ["no_factual_claim_required"],
      }),
    );
  });

  it("passes the raw user turn and TripContext as separate structured context", async () => {
    const converse = vi.fn<BedrockAgentConverse>(async (messages, _tools, modelClass) => {
      expect(modelClass).toBe("decision");
      const contextText = messages[0]?.content.find((block) => "text" in block);
      expect(contextText && "text" in contextText ? contextText.text : "")
        .toContain('"userRequest":"もう少し静かな候補がいい"');
      expect(contextText && "text" in contextText ? contextText.text : "")
        .toContain('"destinationWish":"城崎温泉"');
      expect(contextText && "text" in contextText ? contextText.text : "")
        .not.toContain("利用者の今回の回答");
      return {
        message: { role: "assistant", content: [{ text: "静かに過ごせる候補を探します。" }] },
        stopReason: "end_turn",
      };
    });

    await runViewerAgentRuntime("もう少し静かな候補がいい", {
      trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
      setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
      queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
      getTripContext: () => ({
        planningStage: "inspiration",
        destinationWish: "城崎温泉",
      }),
      maximumRouteTime: 1_800,
    }, converse);

    expect(converse).toHaveBeenCalledOnce();
  });

  it("changes time, searches at that time, and focuses only a search result", async () => {
    let routeTime = 1_000;
    const focusTrain = vi.fn(() => true);
    const storeAgentTrace = vi.fn(async (
      _trace: import("../../usecases/agent/agent-trace").AgentTrace,
    ) => undefined);
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

    const result = await runViewerAgentRuntime(
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
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        storeAgentTrace,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(routeTime).toBe(1_100);
    expect(focusTrain).toHaveBeenCalledWith("service-1");
    expect(result).toContain("はるか16号");
    expect(storeAgentTrace).toHaveBeenCalledOnce();
    expect(storeAgentTrace.mock.calls[0]?.[0].events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_called", toolName: "search_trains" }),
      expect.objectContaining({ type: "viewer_action", status: "applied" }),
    ]));
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

    await runViewerAgentRuntime(
      "深夜の時間にして",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_000,
        setRouteTime,
        focusTrain: vi.fn(),
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

    await runViewerAgentRuntime(
      "列車を見せて",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain,
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

    const result = await runViewerAgentRuntime(
      "今日の混雑のピークは？",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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

    const result = await runViewerAgentRuntime(
      "現在遅れている列車は？",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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

    const result = await runViewerAgentRuntime(
      "18時30分ごろ京都に着く特急はありますか",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_000,
        setRouteTime,
        focusTrain: vi.fn(),
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

  it("changes optional map layers without exposing manual weather", async () => {
    const setLayerVisibility = vi.fn();
    const converse = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: [
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
          content: [{ text: "目的地アーチを表示しました。" }],
        },
        stopReason: "end_turn",
      });

    const result = await runViewerAgentRuntime(
      "目的地アーチを表示して",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 1_100,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
        setLayerVisibility,
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

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

    await runViewerAgentRuntime(
      "平日の10時ごろ大阪に着く特急は？",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => 600,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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

    await runViewerAgentRuntime(
      "京都に行きたい",
      {
        trains: [train],
        getPositions: () => [position],
        getRouteTime: () => routeTime,
        setRouteTime: (value) => { routeTime = value; },
        focusTrain,
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

    const result = await runViewerAgentRuntime(
      "京都に行きたい",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 1_463,
        getCurrentDate: () => new Date("2026-08-14T00:23:00+09:00"),
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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

    const result = await runViewerAgentRuntime(
      "西大路から京都に行きたい",
      {
        trains: [routeTrain],
        getPositions: () => [],
        getRouteTime: () => 1_463,
        getCurrentDate: () => new Date("2026-08-14T00:23:00+09:00"),
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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

    const result = await runViewerAgentRuntime(
      "いまから姫路から関西空港にいきたい",
      {
        trains: [airportRoute],
        getTrains: () => [],
        getPositions: () => [],
        getRouteTime: () => 742,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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

    const result = await runViewerAgentRuntime(
      "8/15の7:00に嵯峨嵐山から関西空港に行きたい",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 600,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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

  it("lets the model inspect a train from the previous verified journey", async () => {
    const converse = previousJourneyToolConverse({
      action: "inspect_train", journeyIndex: 0, legIndex: 1,
    });
    const result = await runViewerAgentRuntime(
      "特急やくもは？",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 420,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(),
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
    expect(converse).toHaveBeenCalledOnce();
    const firstMessage = converse.mock.calls[0]?.[0][0]?.content
      .find((block) => "text" in block);
    expect(firstMessage && "text" in firstMessage ? firstMessage.text : "")
      .toContain('"destinationStation":"出雲市"');
  });

  it("lets the model inspect intermediate stops from the previous journey", async () => {
    const plan = previousJourneyWithStops();
    const result = await runViewerAgentRuntime(
      "新大阪から岡山までに停車する駅は？",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 480,
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
        getPreviousJourneyPlan: () => plan, maximumRouteTime: 1_800,
      },
      previousJourneyToolConverse({
        action: "inspect_stops", journeyIndex: 0, legIndex: 0,
      }),
    );

    expect(typeof result === "string" ? result : result.text).toContain("08:13 新神戸駅");
  });

  it("lets the model propose and apply a verified alternative journey leg", async () => {
    let plan = previousJourneyWithStops();
    let pending: import("../../domain/journey-chat-follow-up").PendingJourneyLegChange | undefined;
    const alternative = {
      ...plan.journeys[0]!.legs[0]!,
      serviceUid: "later-nozomi",
      trainNumber: "101A",
      trainName: "のぞみ101号",
      departureTimeMinutes: 510,
      arrivalTimeMinutes: 570,
    };
    const dependencies = {
      trains: [train], getPositions: () => [], getRouteTime: () => 480,
      setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
      queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
      getPreviousJourneyPlan: () => plan,
      findJourneyLegAlternatives: vi.fn(async () => [alternative]),
      getPendingJourneyLegChange: () => pending,
      setPendingJourneyLegChange: (
        value: import("../../domain/journey-chat-follow-up").PendingJourneyLegChange | undefined,
      ) => { pending = value; },
      maximumRouteTime: 1_800,
    };
    const proposal = await runViewerAgentRuntime(
      "新大阪から岡山まで、もう少し遅い列車にしたい",
      dependencies,
      previousJourneyToolConverse({
        action: "find_alternatives", journeyIndex: 0, legIndex: 0,
        endLegIndex: 0, preferLaterDeparture: true,
      }),
    );
    expect(typeof proposal === "string" ? proposal : proposal.text)
      .toContain("まだ経路は変更していません");
    expect(pending?.alternatives[0]?.serviceUid).toBe("later-nozomi");

    const applied = await runViewerAgentRuntime(
      "1番に変更して",
      dependencies,
      previousJourneyToolConverse({ action: "apply_alternative", alternativeIndex: 0 }),
    );
    const rich = requireRichResponse(applied);
    plan = rich.journeyPlan;
    expect(plan.journeys[0]?.legs[0]?.serviceUid).toBe("later-nozomi");
    expect(pending).toBeUndefined();
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
                excludedServiceTypes: ["新幹線"],
                requiredTrainNames: ["はるか"],
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

    const result = await runViewerAgentRuntime(
      "大阪から京都へ行きたい",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 1_070,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(() => true),
        setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
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
    const converse = previousJourneyToolConverse({
      action: "revise_constraints", excludedServiceTypes: ["新幹線"],
    });
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

    const result = await runViewerAgentRuntime(
      "新幹線を使いたくない",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 900,
        setRouteTime: vi.fn(),
        focusTrain,
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
    expect(converse).toHaveBeenCalledOnce();
  });

  it("carries previous exclusions into a named-train follow-up", async () => {
    const converse = previousJourneyToolConverse({
      action: "revise_constraints", excludedTrainNames: ["やくも"],
    });
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
    const result = await runViewerAgentRuntime(
      "特急やくもを避けて",
      {
        trains: [train],
        getPositions: () => [],
        getRouteTime: () => 600,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(() => true),
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
    expect(converse).toHaveBeenCalledOnce();
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
    const converse = previousJourneyToolConverse({
      action: "revise_constraints", requiredTrainNames: ["やくも"],
    });
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
    const result = await runViewerAgentRuntime(
      "やくもにのりたい",
      {
        trains: [train, yakumoTrain],
        getPositions: () => [],
        getRouteTime: () => 470,
        setRouteTime: vi.fn(),
        focusTrain: vi.fn(() => true),
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
    expect(converse).toHaveBeenCalledOnce();
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
          adults: 2, children: 1, considerations: ["早朝を避ける"],
        },
      } }] },
      stopReason: "tool_use",
    });

    const result = await runViewerAgentRuntime(
      "明日、出雲で1泊して観光したい",
      {
        trains: [izumoTrain], getPositions: () => [], getRouteTime: () => 1_200,
        getCurrentDate: () => new Date("2026-08-16T21:00:00+09:00"),
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
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
    expect(result.travelPlan).toMatchObject({
      adults: 2,
      children: 1,
      considerations: ["早朝を避ける"],
    });
    expect(result.text).toContain("普段許容している移動時間より長め");
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(1, expect.objectContaining({
      originStation: "京都", destinationStation: "出雲市",
      departureDate: "2026-08-17",
    }));
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(2, expect.objectContaining({
      originStation: "出雲市", destinationStation: "京都", departureDate: "2026-08-18",
    }));
  });

  it("continues from a verified stay search to photo-backed place candidates", async () => {
    const izumoTrain: Train = {
      ...train,
      origin_station: "京都",
      destination_station: "出雲市",
      stops: [{ station_name: "出雲市", event: "着", route_time_minutes: 780 }],
    };
    const searchDirectRoutes = vi.fn()
      .mockResolvedValueOnce({ originStation: "京都", results: [] })
      .mockResolvedValueOnce({ originStation: "出雲市", results: [] });
    const searchPlaceMedia = vi.fn(async () => ({
      result: {
        status: "available",
        freshness: "fresh",
        retrievedAt: "2026-08-30T04:00:00.000Z",
        data: {
          places: [{
            providerPlaceId: "izumo-taisha",
            name: "出雲大社",
            latitude: 35.4019,
            longitude: 132.6855,
            sourceUrl: "https://example.com/izumo-taisha",
            openingHoursStatus: "unknown",
            image: {
              url: "https://example.com/izumo.jpg",
              attribution: "Example",
              hotlinkAllowed: true,
            },
          }],
        },
        evidence: [],
      },
    }));
    const converse = vi.fn<BedrockAgentConverse>()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "stay",
          name: "search_accommodations",
          input: {
            destination: "出雲大社",
            checkInDate: "2026-08-31",
            checkOutDate: "2026-09-01",
          },
        } }, { toolUse: {
          toolUseId: "places",
          name: "search_place_media",
          input: { query: "出雲大社 周辺 観光", limit: 5 },
        } }] },
        stopReason: "tool_use",
      });

    const result = await runViewerAgentRuntime(
      "明日から出雲大社へ1泊で旅行したい",
      {
        trains: [izumoTrain], getPositions: () => [], getRouteTime: () => 1_200,
        getCurrentDate: () => new Date("2026-08-30T13:00:00+09:00"),
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        searchAccommodations: vi.fn(async () => ({ accommodations: [] })),
        searchPlaceMedia,
        getUserProfile: () => ({
          home: { station: "京都", carAvailable: false },
          travelStyle: { transferTolerance: 0.5 },
          transport: { maxTypicalTravelMinutes: null },
        } as unknown as UserProfile),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchPlaceMedia).toHaveBeenCalledWith({
      query: "出雲大社 周辺 観光",
      limit: 5,
    });
    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("travelPlan" in result)) {
      throw new Error("写真付き旅行プランがありません。");
    }
    expect(result.external?.places?.data?.places[0]?.image?.url)
      .toBe("https://example.com/izumo.jpg");
  });

  it("builds a day trip without searching accommodations", async () => {
    const searchDirectRoutes = vi.fn()
      .mockResolvedValueOnce({ originStation: "京都", results: [] })
      .mockResolvedValueOnce({ originStation: "宮島口", results: [] });
    const searchAccommodations = vi.fn();
    const converse = vi.fn<BedrockAgentConverse>(async (_messages, tools) => {
      expect(tools?.some(({ name }) => name === "plan_day_trip")).toBe(true);
      expect(tools?.some(({ name }) => name === "search_accommodations")).toBe(true);
      expect(tools?.some(({ name }) => name === "search_weather_forecast")).toBe(false);
      expect(tools?.find(({ name }) => name === "plan_day_trip")?.inputSchema)
        .toMatchObject({ required: ["destination", "date", "stayNights"] });
      expect(tools?.find(({ name }) => name === "search_direct_routes")?.inputSchema)
        .toMatchObject({
          required: ["destinationStation"],
          additionalProperties: false,
          properties: {
            originStation: { type: "string" },
            destinationStation: { type: "string" },
            departureDate: { type: "string" },
            departureTimeMinutes: { type: "integer" },
          },
        });
      expect(tools?.find(({ name }) => name === "ask_follow_up")?.inputSchema)
        .toMatchObject({ properties: { recommendation: { type: "string" } } });
      return {
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "day-trip", name: "plan_day_trip", input: {
            destination: "宮島", date: "2026-08-28", stayNights: 0,
          },
        } }] },
        stopReason: "tool_use",
      };
    });

    const result = await runViewerAgentRuntime(
      "8月28日に宮島へ日帰りで行きたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        searchAccommodations,
        getUserProfile: () => ({
          home: { station: "京都", carAvailable: false },
          travelStyle: { transferTolerance: 0.5 },
          transport: { maxTypicalTravelMinutes: null },
        } as unknown as UserProfile),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchAccommodations).not.toHaveBeenCalled();
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(1, expect.objectContaining({
      originStation: "京都", destinationStation: "宮島口",
      departureDate: "2026-08-28",
    }));
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(2, expect.objectContaining({
      originStation: "宮島口", destinationStation: "京都",
      departureDate: "2026-08-28",
    }));
    if (typeof result === "string" || !("travelPlan" in result)) {
      throw new Error("日帰り旅程がありません。");
    }
    expect(result.travelPlan.dayTrip).toBe(true);
    expect(result.travelPlan.accommodations).toEqual([]);
    expect(result.text).toContain("日帰り旅行");
  });

  it("treats the requested home time as the return arrival deadline", async () => {
    const searchDirectRoutes = vi.fn()
      .mockResolvedValueOnce({
        originStation: "向日町",
        results: [],
        journeys: [{
          departureTimeMinutes: 9 * 60,
          arrivalTimeMinutes: 10 * 60,
          transferCount: 0,
          legs: [],
        }],
      })
      .mockResolvedValueOnce({
        originStation: "奈良",
        results: [],
        journeys: [{
          departureTimeMinutes: 19 * 60,
          arrivalTimeMinutes: 20 * 60 + 30,
          transferCount: 0,
          legs: [],
        }],
      });
    const converse = vi.fn<BedrockAgentConverse>(async () => ({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "nara-day-trip",
        name: "plan_day_trip",
        input: {
          destination: "奈良公園",
          date: "2026-08-31",
          stayNights: 0,
          returnDepartureTimeMinutes: 21 * 60,
        },
      } }] },
      stopReason: "tool_use",
    }));

    await runViewerAgentRuntime(
      "8月31日に奈良公園へ 朝9:00に出て 夜の21:00には家についていたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 900,
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes,
        getUserProfile: () => ({
          home: { station: "向日町", carAvailable: false },
          travelStyle: { transferTolerance: 0.5 },
          transport: { maxTypicalTravelMinutes: null },
        } as unknown as UserProfile),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenNthCalledWith(1, expect.objectContaining({
      departureTimeMinutes: 9 * 60,
    }));
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(2, expect.objectContaining({
      originStation: "奈良",
      destinationStation: "向日町",
      arrivalTimeLimitMinutes: 21 * 60,
      rankingPreference: "latest-departure",
    }));
  });

  it("proposes a clear day-trip change without asking for confirmation again", async () => {
    const searchDirectRoutes = vi.fn()
      .mockResolvedValueOnce({ originStation: "京都", results: [] })
      .mockResolvedValueOnce({ originStation: "宮島口", results: [] });
    const searchAccommodations = vi.fn();
    const converse = vi.fn<BedrockAgentConverse>(async () => ({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "day-trip-update", name: "plan_day_trip", input: {
          destination: "宮島", date: "2026-08-28", stayNights: 0,
        },
      } }] },
      stopReason: "tool_use",
    }));

    const result = await runViewerAgentRuntime(
      "やっぱり8月28日の日帰りに変更して",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        searchAccommodations, getTripPlan: () => tripPlanWithRailReturn(),
        getUserProfile: () => ({
          home: { station: "京都", carAvailable: false },
          travelStyle: { transferTolerance: 0.5 },
          transport: { maxTypicalTravelMinutes: null },
        } as unknown as UserProfile),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(converse).toHaveBeenCalledTimes(1);
    expect(searchAccommodations).not.toHaveBeenCalled();
    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("tripPlanUpdate" in result)) {
      throw new Error("日帰りへの変更案がありません。");
    }
    expect(result.text).toContain("日帰り旅行へ組み直しました");
    expect(result.text).not.toContain("よろしいですか");
    expect(result.tripPlanUpdate.summary).toContain("日帰り旅行へ変更");
  });

  it("passes a bounded accommodation contract to the conversation model", async () => {
    const converse = vi.fn<BedrockAgentConverse>(async (_messages, tools) => {
      const accommodation = tools?.find(({ name }) => name === "search_accommodations");
      expect(accommodation?.inputSchema).toMatchObject({
        required: ["destination", "checkInDate", "checkOutDate"],
        additionalProperties: false,
        properties: {
          destination: { type: "string" },
          checkInDate: { type: "string" },
          checkOutDate: { type: "string" },
          adults: { type: "integer", minimum: 1, maximum: 10 },
          limit: { type: "integer", minimum: 1, maximum: 5 },
        },
      });
      return {
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "stay", name: "search_accommodations", input: {
            destination: "宮島", checkInDate: "2026-08-28",
            checkOutDate: "2026-08-29",
          },
        } }] },
        stopReason: "tool_use",
      };
    });

    await runViewerAgentRuntime(
      "明日から宮島へ1泊したい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(),
        searchAccommodations: vi.fn(async () => ({ accommodations: [] })),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(converse).toHaveBeenCalled();
  });

  it("explains the same-area assumption and alternatives for a long stay", async () => {
    const searchDirectRoutes = vi.fn()
      .mockResolvedValueOnce({ originStation: "京都", results: [] })
      .mockResolvedValueOnce({ originStation: "宮島口", results: [] });
    const converse = vi.fn<BedrockAgentConverse>(async () => ({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "long-stay", name: "search_accommodations", input: {
          destination: "宮島",
          checkInDate: "2026-08-28",
          checkOutDate: "2026-08-31",
        },
      } }] },
      stopReason: "tool_use",
    }));

    const result = await runViewerAgentRuntime(
      "8月28日から宮島へ3泊したい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        searchAccommodations: vi.fn(async () => ({ accommodations: [] })),
        getUserProfile: () => ({
          home: { station: "京都", carAvailable: false },
          travelStyle: { transferTolerance: 0.5 },
          transport: { maxTypicalTravelMinutes: null },
        } as unknown as UserProfile),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("travelPlan" in result)) {
      throw new Error("長期旅行の旅程がありません。");
    }
    expect(result.text).toContain("3泊を同じ地域で過ごす前提");
    expect(result.text).toContain("広島や倉敷美観地区");
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

    await runViewerAgentRuntime(
      "明日、出雲大社に1泊して観光したい",
      {
        trains: [izumoTrain], getPositions: () => [], getRouteTime: () => 1_200,
        getCurrentDate: () => new Date("2026-08-16T21:00:00+09:00"),
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
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

  it("resolves a landmark and qualitative time without requiring model minute arithmetic", async () => {
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "向日町",
      results: [],
    }));
    const converse = vi.fn()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "route",
          name: "search_direct_routes",
          input: {
            originStation: "向日町",
            destinationStation: "出雲大社",
            departureDate: "2026-08-28",
          },
        } }] },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ text: "明日の朝に向日町から出雲市へ向かう経路を確認しました。" }] },
        stopReason: "end_turn",
      });

    await runViewerAgentRuntime(
      [
        "旅行相談の会話を継続しています。",
        '現在の旅行条件: {"destinationWish":"出雲大社","startDate":"2026-08-28","endDate":"2026-08-29","stayNights":1}',
        "直前の質問: いつ出発しますか？",
        "利用者の今回の回答: 明日の朝出発",
      ].join("\n"),
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        getCurrentDate: () => new Date("2026-08-27T14:00:00+09:00"),
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        getUserProfile: () => ({
          version: 2,
          home: { station: "向日町", carAvailable: false },
          companions: { usual: [], children: [] },
          travelStyle: {
            pace: 0.5, novelty: 0.5,
            crowdTolerance: 0.5, walkingTolerance: 0.5,
            transferTolerance: 0.5, earlyMorningTolerance: 0.5,
            lateNightTolerance: 0.5,
            drivingTolerance: 0.5, busTolerance: 0.5,
          },
          preferences: {
            sea: 0.3, mountain: 0.3, nature: 0.8, onsen: 0.3,
            food: 0.7, railway: 0.3, history: 0.8, cityWalk: 0.3,
            animals: 0.3, art: 0.3, themePark: 0.3, shopping: 0.3,
          },
          transport: { maxTypicalTravelMinutes: null },
          updatedAt: "2026-08-27T00:00:00.000Z",
        }),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith(expect.objectContaining({
      originStation: "向日町",
      destinationStation: "出雲市",
      departureTimeMinutes: 480,
      departureDate: "2026-08-28",
      serviceDate: "2026-08-28",
    }));
  });

  it("asks whether to plan the trip before asking for dates", async () => {
    const searchPlaceMedia = vi.fn(async () => ({
      result: {
        status: "available" as const,
        freshness: "fresh" as const,
        retrievedAt: "2026-08-30T04:00:00.000Z",
        data: { places: [{
          providerPlaceId: "izumo-taisha",
          name: "出雲大社",
          latitude: 35.4019,
          longitude: 132.6855,
          sourceUrl: "https://example.com/izumo-taisha",
          openingHoursStatus: "unknown" as const,
        }] },
        evidence: [],
      },
    }));
    const converse = vi.fn()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "place", name: "search_place_media",
          input: { query: "出雲大社", limit: 4 },
        } }] },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "follow-up", name: "ask_follow_up", input: {
          recommendation: "大阪方面からなら1泊にして、出雲大社と稲佐の浜をゆっくり巡るのがおすすめです。",
          reason: "出発日が分かると実際のダイヤと宿泊日を揃えて比較できます。日程未定なら混雑を避けやすい候補日から考えられます。",
          question: "この場所を軸に旅を考えてみますか？",
          expectedInput: "planning-intent",
          quickReplies: [
            { label: "1泊", value: "1泊" },
            { label: "2泊", value: "2泊" },
          ],
          tripContext: {
            destinationWish: "出雲大社",
            planningStage: "inspiration",
          },
        },
      } }] },
      stopReason: "tool_use",
      });

    const result = await runViewerAgentRuntime(
      "出雲大社へ旅行したい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchPlaceMedia, maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("conversation" in result)) {
      throw new Error("会話ガイダンスがありません。");
    }
    expect(result.conversation).toMatchObject({
      recommendation: expect.stringContaining("稲佐の浜"),
      expectedInput: "planning-intent",
      tripContext: { destinationWish: "出雲大社", planningStage: "inspiration" },
    });
    expect(result.conversation.question).toBe("この場所を軸に旅を考えてみますか？");
    expect(result.conversation.quickReplies).toEqual([
      { label: "旅程を考える", value: "旅程を考えたい" },
      { label: "もう少し見たい", value: "もう少し見たい" },
    ]);
    expect(result.text).toContain("1泊にして");
    expect(result.text).not.toContain("構造化した案内を準備しました");
    expect(searchPlaceMedia).toHaveBeenCalledWith({ query: "出雲大社", limit: 4 });
  });

  it("discovers a concrete destination before planning from a vague travel mood", async () => {
    const searchPlaceMedia = vi.fn(async () => ({
      result: {
        status: "available" as const,
        freshness: "fresh" as const,
        retrievedAt: "2026-09-01T04:00:00.000Z",
        data: { places: [{
          providerPlaceId: "kinosaki-onsen",
          name: "城崎温泉",
          latitude: 35.6244,
          longitude: 134.8132,
          sourceUrl: "https://example.com/kinosaki-onsen",
          openingHoursStatus: "unknown" as const,
        }] },
        evidence: [],
      },
    }));
    const converse = vi.fn<BedrockAgentConverse>()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "premature-planning",
          name: "ask_follow_up",
          input: {
            question: "この場所を軸に旅を考えてみますか？",
            expectedInput: "planning-intent",
            quickReplies: [
              { label: "旅程を考える", value: "旅程を考えたい" },
              { label: "もう少し見たい", value: "もう少し見たい" },
            ],
            tripContext: {
              destinationWish: "リラックスできる場所",
              planningStage: "inspiration",
            },
          },
        } }] },
        stopReason: "tool_use",
      })
      .mockImplementationOnce(async (messages) => {
        const failedFollowUp = messages.flatMap(({ content }) => content)
          .find((content) => "toolResult" in content);
        expect(failedFollowUp && "toolResult" in failedFollowUp
          ? failedFollowUp.toolResult.status
          : undefined).toBe("error");
        return {
          message: { role: "assistant", content: [{ toolUse: {
            toolUseId: "destination-discovery",
            name: "search_place_media",
            input: { query: "静かに過ごせる温泉 自然 関西", limit: 4 },
          } }] },
          stopReason: "tool_use",
        };
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "verified-planning",
          name: "ask_follow_up",
          input: {
            recommendation: "城崎温泉なら、外湯めぐりの合間に休みながら過ごせます。",
            question: "城崎温泉を軸に旅を考えてみますか？",
            expectedInput: "planning-intent",
            quickReplies: [
              { label: "旅程を考える", value: "旅程を考えたい" },
              { label: "ほかも見る", value: "ほかも見たい" },
            ],
            tripContext: {
              destinationWish: "城崎温泉",
              planningStage: "inspiration",
            },
          },
        } }] },
        stopReason: "tool_use",
      });

    const result = await runViewerAgentRuntime(
      "リラックスできる場所に行きたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
        searchPlaceMedia, maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchPlaceMedia).toHaveBeenCalledWith({
      query: "静かに過ごせる温泉 自然 関西",
      limit: 4,
    });
    if (typeof result === "string" || !("conversation" in result)) {
      throw new Error("具体的な候補を伴う旅行相談がありません。");
    }
    expect(result.conversation.question).toBe("城崎温泉を軸に旅を考えてみますか？");
    expect(result.conversation.recommendation).toContain("城崎温泉");
    expect(result.conversation.tripContext.destinationWish).toBe("城崎温泉");
    expect(converse).toHaveBeenCalledTimes(3);
  });

  it("keeps the stay-length follow-up selected by Bedrock", async () => {
    const converse = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "stay-kind", name: "ask_follow_up", input: {
          recommendation: "奈良公園への日帰り旅行を提案します。",
          reason: "日帰り旅行の詳細を確認するため",
          question: "日帰りですか？ それとも何泊しますか？",
          expectedInput: "stay-length",
          quickReplies: [],
          tripContext: { destinationWish: "奈良公園", startDate: "2026-08-31" },
        },
      } }] },
      stopReason: "tool_use",
    });

    const result = await runViewerAgentRuntime([
      '現在の旅行条件: {"destinationWish":"奈良公園"}',
      "利用者の今回の回答: 明日",
    ].join("\n"), {
      trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
      getCurrentDate: () => new Date("2026-08-30T15:00:00+09:00"),
      setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
      queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
      maximumRouteTime: 1_800,
    }, converse);

    if (typeof result === "string" || !("conversation" in result)) {
      throw new Error("旅行相談の追加質問がありません。");
    }
    expect(result.conversation.expectedInput).toBe("stay-length");
    expect(result.conversation.question).toBe("日帰りですか？ それとも何泊しますか？");
  });

  it("returns a known-condition follow-up failure to Bedrock and lets it replan", async () => {
    const converse = vi.fn<BedrockAgentConverse>()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "known-date",
          name: "ask_follow_up",
          input: {
            question: "いつ出発しますか？",
            expectedInput: "departure-date",
            quickReplies: [],
            tripContext: {
              destinationWish: "出雲大社",
              startDate: "2026-08-31",
              planningStage: "planning",
            },
          },
        } }] },
        stopReason: "tool_use",
      })
      .mockImplementationOnce(async (messages) => {
        const toolResult = messages.flatMap(({ content }) => content)
          .find((content) => "toolResult" in content);
        expect(toolResult && "toolResult" in toolResult
          ? toolResult.toolResult.status
          : undefined).toBe("error");
        return {
          message: { role: "assistant", content: [{ toolUse: {
            toolUseId: "missing-stay",
            name: "ask_follow_up",
            input: {
              question: "日帰りですか？ それとも何泊しますか？",
              expectedInput: "stay-length",
              quickReplies: [],
              tripContext: {
                destinationWish: "出雲大社",
                startDate: "2026-08-31",
                planningStage: "planning",
              },
            },
          } }] },
          stopReason: "tool_use",
        };
      });

    const result = await runViewerAgentRuntime([
      '現在の旅行条件: {"destinationWish":"出雲大社","startDate":"2026-08-31","planningStage":"planning"}',
      "利用者の今回の回答: 旅程を考えたい",
    ].join("\n"), {
      trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
      getCurrentDate: () => new Date("2026-08-30T15:00:00+09:00"),
      setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
      queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
      maximumRouteTime: 1_800,
    }, converse);

    if (typeof result === "string" || !("conversation" in result)) {
      throw new Error("再計画後の追加質問がありません。");
    }
    expect(result.conversation.expectedInput).toBe("stay-length");
    expect(converse).toHaveBeenCalledTimes(2);
  });

  it("replans from an optional departure-time question to accommodation search", async () => {
    const searchAccommodations = vi.fn(async () => ({ accommodations: [] }));
    const converse = vi.fn<BedrockAgentConverse>()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "optional-time",
          name: "ask_follow_up",
          input: {
            question: "明日の何時頃に出発しますか？",
            expectedInput: "planning-intent",
            quickReplies: [
              { label: "6:00", value: "6:00" },
              { label: "7:00", value: "7:00" },
            ],
            tripContext: {
              planningStage: "planning",
              destinationWish: "出雲大社",
              startDate: "2026-08-31",
              endDate: "2026-09-01",
              stayNights: 1,
            },
          },
        } }] },
        stopReason: "tool_use",
      })
      .mockImplementationOnce(async (messages) => {
        const toolResult = messages.flatMap(({ content }) => content)
          .find((content) => "toolResult" in content);
        expect(toolResult && "toolResult" in toolResult
          ? toolResult.toolResult.status
          : undefined).toBe("error");
        return {
          message: { role: "assistant", content: [{ toolUse: {
            toolUseId: "stay-search",
            name: "search_accommodations",
            input: {
              destination: "出雲大社",
              checkInDate: "2026-08-31",
              checkOutDate: "2026-09-01",
            },
          } }] },
          stopReason: "tool_use",
        };
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ text: "宿泊候補を確認しました。" }] },
        stopReason: "end_turn",
      });

    await runViewerAgentRuntime([
      '現在の旅行条件: {"planningStage":"planning","destinationWish":"出雲大社","startDate":"2026-08-31","endDate":"2026-09-01","stayNights":1}',
      "利用者の今回の回答: 早朝で1泊",
    ].join("\n"), {
      trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
      getCurrentDate: () => new Date("2026-08-30T15:00:00+09:00"),
      setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
      queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
      searchAccommodations, maximumRouteTime: 1_800,
    }, converse);

    expect(searchAccommodations).toHaveBeenCalledWith(expect.objectContaining({
      destination: "出雲",
      checkInDate: "2026-08-31",
      checkOutDate: "2026-09-01",
    }));
    expect(converse).toHaveBeenCalledTimes(3);
  });

  it("lets the model choose an inspiration follow-up from available capabilities", async () => {
    const searchDirectRoutes = vi.fn();
    const searchPlaceMedia = vi.fn(async () => ({
      result: {
        status: "available" as const,
        freshness: "fresh" as const,
        retrievedAt: "2026-08-30T04:00:00.000Z",
        data: { places: [{
          providerPlaceId: "izumo-taisha",
          name: "出雲大社",
          latitude: 35.4019,
          longitude: 132.6855,
          sourceUrl: "https://example.com/izumo-taisha",
          openingHoursStatus: "unknown" as const,
        }] },
        evidence: [],
      },
    }));
    const converse = vi.fn<BedrockAgentConverse>()
      .mockImplementationOnce(async (_messages, tools) => {
      expect(tools?.some(({ name }) => name === "ask_follow_up")).toBe(true);
      expect(tools?.some(({ name }) => name === "search_direct_routes")).toBe(true);
      expect(tools?.some(({ name }) => name === "search_accommodations")).toBe(false);
      return {
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "place", name: "search_place_media",
          input: { query: "出雲大社", limit: 4 },
        } }] },
        stopReason: "tool_use",
      };
      })
      .mockResolvedValueOnce({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "follow-up",
        name: "ask_follow_up",
        input: {
          recommendation: "出雲大社と稲佐の浜を組み合わせるなら1泊がおすすめです。",
          reason: "実際の列車と宿泊日を同じ日程で確認できます。",
          question: "この場所を軸に旅を考えてみますか？",
          expectedInput: "planning-intent",
          quickReplies: [
            { label: "旅程を考える", value: "旅程を考えたい" },
            { label: "もう少し見たい", value: "もう少し見たい" },
          ],
          tripContext: {
            destinationWish: "出雲大社",
            planningStage: "inspiration",
          },
        },
      } }] },
      stopReason: "tool_use",
      });

    const result = await runViewerAgentRuntime(
      "出雲大社へ旅行したい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes, searchPlaceMedia,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).not.toHaveBeenCalled();
    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("conversation" in result)) {
      throw new Error("旅行相談の追加質問がありません。");
    }
    expect(result.text).not.toContain("構造化した案内");
    expect(result.conversation).toMatchObject({
      expectedInput: "planning-intent",
      question: "この場所を軸に旅を考えてみますか？",
      tripContext: { destinationWish: "出雲大社", planningStage: "inspiration" },
    });
    expect(converse).toHaveBeenCalledTimes(2);
  });

  it("returns destination photos before asking whether to build an itinerary", async () => {
    const searchPlaceMedia = vi.fn(async () => ({
      result: {
        status: "available" as const,
        freshness: "fresh" as const,
        retrievedAt: "2026-08-30T04:00:00.000Z",
        data: { places: [{
          providerPlaceId: "izumo-taisha",
          name: "出雲大社",
          latitude: 35.4019,
          longitude: 132.6855,
          sourceUrl: "https://example.com/izumo-taisha",
          openingHoursStatus: "unknown" as const,
          image: {
            url: "https://example.com/izumo.jpg",
            attribution: "Example",
            hotlinkAllowed: true as const,
          },
        }] },
        evidence: [],
      },
    }));
    const searchWeb = vi.fn(async () => ({
      webSearch: {
        status: "available" as const,
        freshness: "fresh" as const,
        retrievedAt: "2026-08-30T04:00:00.000Z",
        data: {
          query: "出雲大社 見どころ 口コミ 周辺 観光",
          results: [{
            id: "official",
            title: "出雲大社と周辺の案内",
            url: "https://example.com/guide",
            description: "参拝と稲佐の浜を組み合わせられます。",
          }],
        },
        evidence: [],
      },
    }));
    const readWebPages = vi.fn(async () => ({
      webPages: {
        status: "available" as const,
        freshness: "fresh" as const,
        retrievedAt: "2026-08-30T04:00:00.000Z",
        data: { pages: [{
          url: "https://example.com/guide",
          title: "出雲大社と周辺の案内",
          text: "境内の参拝に加えて稲佐の浜や神門通りを巡れます。",
          contentType: "html" as const,
          truncated: false,
          untrustedExternalContent: true as const,
        }] },
        evidence: [],
      },
    }));
    const converse = vi.fn<BedrockAgentConverse>()
      .mockImplementationOnce(async (_messages, tools) => {
        expect(tools?.map(({ name }) => name)).toEqual(expect.arrayContaining([
          "search_place_media",
          "search_web",
          "read_web_pages",
          "ask_follow_up",
        ]));
        expect(tools?.some(({ name }) => name === "search_accommodations")).toBe(false);
        return {
          message: { role: "assistant", content: [{ toolUse: {
            toolUseId: "photo",
            name: "search_place_media",
            input: { query: "出雲大社 周辺 観光", limit: 4 },
          } }] },
          stopReason: "tool_use",
        };
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "web-search",
          name: "search_web",
          input: { query: "出雲大社 見どころ 口コミ 周辺 観光", limit: 4 },
        } }] },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "web-pages",
          name: "read_web_pages",
          input: { urls: ["https://example.com/guide"] },
        } }] },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "place-detail",
          name: "resolve_place_candidates",
          input: {
            candidates: [{
              name: "出雲大社",
              sourceUrl: "https://example.com/guide",
              overview: "歴史や自然が好きな人には、参拝と周辺散策を一緒に楽しめる点が合いそうです。",
              highlights: ["境内の参拝", "稲佐の浜とのつながり"],
              atmosphere: "境内と周辺を歩きながら土地の物語を感じられます。",
              tips: ["神門通りと組み合わせると回りやすいです。"],
              nearby: ["稲佐の浜", "神門通り"],
            }],
          },
        } }] },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "intent",
          name: "ask_follow_up",
          input: {
            recommendation: "出雲大社は参拝だけでなく、歴史が好きなら稲佐の浜や神門通りまでつなげて歩くと土地の物語を感じやすい場所です。訪れた人が評価する点として、境内の空気感と周辺散策を一緒に楽しめることが紹介されています。",
            question: "この場所を軸に旅を考えてみますか？",
            expectedInput: "planning-intent",
            quickReplies: [
              { label: "旅程を考える", value: "旅程を考えたい" },
              { label: "もう少し見たい", value: "もう少し見たい" },
            ],
            tripContext: { destinationWish: "出雲大社", planningStage: "inspiration" },
          },
        } }] },
        stopReason: "tool_use",
      });

    const result = await runViewerAgentRuntime("出雲大社に行きたい", {
      trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
      setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
      queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
      searchPlaceMedia, searchWeb, readWebPages,
      getUserProfile: () => ({
        version: 2,
        home: { station: "向日町", carAvailable: false },
        companions: { usual: ["solo"], children: [] },
        travelStyle: {
          pace: 0.4, novelty: 0.5,
          crowdTolerance: 0.4, walkingTolerance: 0.6,
          transferTolerance: 0.5, earlyMorningTolerance: 0.3,
          lateNightTolerance: 0.4, drivingTolerance: 0.3,
          busTolerance: 0.5,
        },
        preferences: {
          sea: 0.3, mountain: 0.3, nature: 0.8, onsen: 0.3,
          food: 0.3, railway: 0.3, history: 0.8, cityWalk: 0.3,
          animals: 0.3, art: 0.3, themePark: 0.3, shopping: 0.3,
        },
        transport: { maxTypicalTravelMinutes: 240 },
        updatedAt: "2026-08-30T00:00:00.000Z",
      }),
      maximumRouteTime: 1_800,
    }, converse);

    expect(searchPlaceMedia).toHaveBeenNthCalledWith(1, {
      query: "出雲大社 周辺 観光", limit: 4,
    });
    expect(searchWeb).toHaveBeenCalledOnce();
    expect(readWebPages).toHaveBeenCalledWith({ urls: ["https://example.com/guide"] });
    if (typeof result === "string" || !("conversation" in result)) {
      throw new Error("写真付きの旅行相談がありません。");
    }
    expect(result.conversation.expectedInput).toBe("planning-intent");
    expect(result.text).toContain("歴史が好きなら");
    expect(result.conversation.tripContext.destinationWish).toBe("出雲大社");
    expect(result.external?.places?.data?.places[0]?.image?.url)
      .toBe("https://example.com/izumo.jpg");
    expect(result.external?.places?.data?.places[0]?.detail?.nearby)
      .toEqual(["稲佐の浜", "神門通り"]);
  });

  it("does not search accommodations with dates invented outside the conversation", async () => {
    const searchAccommodations = vi.fn();
    const searchPlaceMedia = vi.fn(async () => ({
      result: {
        status: "available" as const,
        freshness: "fresh" as const,
        retrievedAt: "2026-08-30T04:00:00.000Z",
        data: { places: [{
          providerPlaceId: "izumo-taisha",
          name: "出雲大社",
          latitude: 35.4019,
          longitude: 132.6855,
          sourceUrl: "https://example.com/izumo-taisha",
          openingHoursStatus: "unknown" as const,
        }] },
        evidence: [],
      },
    }));
    const converse = vi.fn<BedrockAgentConverse>()
      .mockImplementationOnce(async (_messages, tools) => {
      expect(tools?.some(({ name }) => name === "search_accommodations")).toBe(true);
      return {
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "place", name: "search_place_media",
          input: { query: "出雲大社", limit: 4 },
        } }] },
        stopReason: "tool_use",
      };
      })
      .mockResolvedValueOnce({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "inspiration",
        name: "ask_follow_up",
        input: {
          recommendation: "まずは出雲大社の雰囲気から見てみましょう。",
          question: "旅程を考えてみますか？",
          expectedInput: "planning-intent",
          quickReplies: [{ label: "旅程を考える", value: "旅程を考えたい" }],
          tripContext: { destinationWish: "出雲大社", planningStage: "inspiration" },
        },
      } }] },
      stopReason: "tool_use",
      });

    const result = await runViewerAgentRuntime(
      "出雲大社へ旅行したい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchAccommodations, searchPlaceMedia,
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchAccommodations).not.toHaveBeenCalled();
    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("conversation" in result)) {
      throw new Error("旅行相談の追加質問がありません。");
    }
    expect(result.conversation.expectedInput).toBe("planning-intent");
    expect(result.conversation.tripContext).not.toHaveProperty("startDate");
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
          }, {
            type: "metadata",
            adults: 2,
            children: 1,
            considerations: ["歩く時間を短めにする"],
          }],
        },
      } }] },
      stopReason: "tool_use",
    });

    const result = await runViewerAgentRuntime(
      "駅からレンタカーを借りたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
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
    expect(result.tripPlanUpdate.patches[1]).toEqual({
      type: "metadata",
      conditions: {
        adults: 2,
        children: 1,
        considerations: ["歩く時間を短めにする"],
      },
    });
    expect(result.text).toBe("駅から宿までレンタカー移動を追加");
    expect(result.text).not.toContain("構造化した案内を準備しました");
    vi.unstubAllGlobals();
  });

  it("lets the model select a trip-plan update without hiding other available tools", async () => {
    const searchDirectRoutes = vi.fn();
    const converse = vi.fn<BedrockAgentConverse>(async (_messages, tools) => {
      expect(tools?.some(({ name }) => name === "propose_trip_update")).toBe(true);
      expect(tools?.some(({ name }) => name === "ask_follow_up")).toBe(true);
      expect(tools?.some(({ name }) => name === "search_direct_routes")).toBe(true);
      return {
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "add-sightseeing",
          name: "propose_trip_update",
          input: {
            summary: "出雲大社を観光予定へ追加",
            patches: [{
              type: "addSightseeing",
              name: "出雲大社",
              afterId: "outbound",
              date: "2026-09-01",
            }],
          },
        } }] },
        stopReason: "tool_use",
      };
    });

    const result = await runViewerAgentRuntime(
      "出雲大社を旅程へ追加したい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
        queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
        searchDirectRoutes, maximumRouteTime: 1_800,
        getTripPlan: () => ({
          version: 1, id: "trip", title: "出雲の旅", destination: "出雲",
          updatedAt: "2026-08-30", items: [
            { id: "outbound", type: "movement", mode: "rail", route: {
              originStation: "向日町", destinationStation: "出雲市",
              journeys: [],
            } },
            { id: "return", type: "movement", mode: "rail", route: {
              originStation: "出雲市", destinationStation: "向日町",
              journeys: [],
            } },
          ],
        }),
      },
      converse,
    );

    expect(searchDirectRoutes).not.toHaveBeenCalled();
    expect(typeof result).not.toBe("string");
    if (typeof result === "string" || !("tripPlanUpdate" in result)) {
      throw new Error("旅程変更案がありません。");
    }
    expect(result.tripPlanUpdate).toMatchObject({
      summary: "出雲大社を観光予定へ追加",
      patches: [{
        type: "add",
        item: {
          type: "sightseeing",
          place: { name: "出雲大社", provider: "manual" },
          date: "2026-09-01",
        },
        afterId: "outbound",
      }],
    });
  });

  it("re-searches only the return route at a later departure time", async () => {
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "倉敷", results: [],
    }));
    const converse = vi.fn<BedrockAgentConverse>(async () => ({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "return-later", name: "search_trip_route_update", input: {
          target: "return", departureTimeMinutes: 18 * 60,
        },
      } }] },
      stopReason: "tool_use",
    }));
    const result = await runViewerAgentRuntime(
      "倉敷から摂津富田までの帰りを18時まで後ろ倒しにしたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        getTripPlan: () => tripPlanWithRailReturn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );
    expect(searchDirectRoutes).toHaveBeenCalledWith(expect.objectContaining({
      originStation: "倉敷", destinationStation: "摂津富田",
      departureTimeMinutes: 18 * 60,
    }));
    if (typeof result === "string" || !("tripPlanUpdate" in result)) {
      throw new Error("帰路変更案がありません。");
    }
    expect(result.tripPlanUpdate.patches).toHaveLength(1);
    expect(result.tripPlanUpdate.summary).toContain("帰りの出発");
  });

  it("re-searches an existing return route by its home-arrival deadline", async () => {
    const searchDirectRoutes = vi.fn(async () => ({
      originStation: "倉敷",
      results: [],
      journeys: [{
        departureTimeMinutes: 19 * 60,
        arrivalTimeMinutes: 20 * 60 + 45,
        transferCount: 1,
        legs: [],
      }],
    }));
    const converse = vi.fn<BedrockAgentConverse>()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "return-by-home-time",
          name: "search_trip_route_update",
          input: { target: "return", arrivalTimeLimitMinutes: 21 * 60 },
        } }] },
        stopReason: "tool_use",
      });

    const result = await runViewerAgentRuntime(
      "夜の21:00には家についていたいです",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        getTripPlan: () => tripPlanWithRailReturn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );

    expect(searchDirectRoutes).toHaveBeenCalledWith(expect.objectContaining({
      originStation: "倉敷",
      destinationStation: "摂津富田",
      arrivalTimeLimitMinutes: 21 * 60,
      rankingPreference: "latest-departure",
    }));
    if (typeof result === "string" || !("tripPlanUpdate" in result)) {
      throw new Error("帰宅期限を反映した旅程変更案がありません。");
    }
    expect(result.tripPlanUpdate.summary).toContain("21時00分までに到着");
  });

  it("splits a rail movement around a requested stopover", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "stopover" });
    const searchDirectRoutes = vi.fn()
      .mockResolvedValueOnce({
        originStation: "倉敷", results: [{
          train, originStation: "倉敷", destinationStation: "岡山",
          departureTimeMinutes: 600, arrivalTimeMinutes: 620,
        }],
      })
      .mockResolvedValueOnce({ originStation: "岡山", results: [] });
    const converse = vi.fn<BedrockAgentConverse>(async () => ({
      message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "stopover", name: "search_trip_route_update", input: {
          target: "return", stopoverStation: "岡山",
        },
      } }] },
      stopReason: "tool_use",
    }));
    const result = await runViewerAgentRuntime(
      "帰りの途中で岡山に寄りたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), searchDirectRoutes,
        getTripPlan: () => tripPlanWithRailReturn(),
        maximumRouteTime: 1_800,
      },
      converse,
    );
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(1, expect.objectContaining({
      originStation: "倉敷", destinationStation: "岡山",
    }));
    expect(searchDirectRoutes).toHaveBeenNthCalledWith(2, expect.objectContaining({
      originStation: "岡山", destinationStation: "摂津富田",
    }));
    if (typeof result === "string" || !("tripPlanUpdate" in result)) {
      throw new Error("立寄り変更案がありません。");
    }
    expect(result.tripPlanUpdate.patches).toHaveLength(2);
    expect(result.tripPlanUpdate.summary).toContain("岡山への立寄り");
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

    const result = await runViewerAgentRuntime(
      "旅行ではいつも早朝を避けたい",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
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

  it("passes a safe profile and current trip summary instead of asking the model to rediscover them", async () => {
    const converse = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: [{ text: "現在の旅程を基に案内します。" }] },
      stopReason: "end_turn",
    });
    await runViewerAgentRuntime(
      "現在の旅程を教えて",
      {
        trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
        setRouteTime: vi.fn(), focusTrain: vi.fn(),
        setLayerVisibility: vi.fn(), queryDailyCongestionAnalysis: vi.fn(),
        queryTrainDelayAnalysis: vi.fn(), maximumRouteTime: 1_800,
        getUserProfile: () => ({
          version: 2,
          home: { station: "向日町駅", carAvailable: false },
          companions: { usual: ["partner"], children: [] },
          travelStyle: {
            pace: 0.3, novelty: 0.7, crowdTolerance: 0.2, walkingTolerance: 0.5,
            transferTolerance: 0.5, earlyMorningTolerance: 0.2, lateNightTolerance: 0.5,
            drivingTolerance: 0.2, busTolerance: 0.5,
          },
          preferences: {
            sea: 0.3, mountain: 0.3, nature: 0.8, onsen: 0.3, food: 0.7,
            railway: 0.3, history: 0.8, cityWalk: 0.3, animals: 0.3, art: 0.3,
            themePark: 0.3, shopping: 0.3,
          },
          transport: { maxTypicalTravelMinutes: 180 },
          updatedAt: "2026-08-27T00:00:00Z",
        }),
        getTripPlan: tripPlanWithRailReturn,
      },
      converse,
    );

    const firstPrompt = JSON.stringify(converse.mock.calls[0]?.[0]);
    expect(firstPrompt).toContain("向日町駅");
    expect(firstPrompt).toContain("倉敷を巡る旅");
    expect(firstPrompt).toContain("倉敷→摂津富田");
    expect(firstPrompt).not.toContain("updatedAt");
    expect(firstPrompt).not.toContain('"id":"trip"');
  });

  it("discovers a requested facility type without abandoning the current trip", async () => {
    const searchWeb = vi.fn(async () => ({ webSearch: {
      status: "available" as const, freshness: "fresh" as const, evidence: [],
      data: { query: "出雲大社 酒蔵", results: [{
        id: "brewery-guide", title: "出雲の酒蔵案内",
        url: "https://tourism.example/izumo-sake",
        description: "旭日酒造の見学情報",
      }] },
    } }));
    const readWebPages = vi.fn(async () => ({ webPages: {
      status: "available" as const, freshness: "fresh" as const, evidence: [],
      data: { pages: [{
        url: "https://tourism.example/izumo-sake",
        title: "出雲の酒蔵案内", text: "旭日酒造では地酒を扱っています。",
        contentType: "html" as const, truncated: false,
        untrustedExternalContent: true as const,
      }] },
    } }));
    const searchPlaceMedia = vi.fn(async () => ({ result: {
      status: "available" as const, freshness: "fresh" as const, evidence: [],
      data: { places: [{
        providerPlaceId: "mapbox.asahi",
        name: "旭日酒造", latitude: 35.36, longitude: 132.75,
        sourceUrl: "https://www.mapbox.com/", openingHoursStatus: "unknown" as const,
      }] },
    } }));
    const converse = vi.fn<BedrockAgentConverse>()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "web", name: "search_web",
          input: { query: "出雲大社 酒蔵 公式 観光", limit: 4 },
        } }] }, stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "pages", name: "read_web_pages",
          input: { urls: ["https://tourism.example/izumo-sake"] },
        } }] }, stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ toolUse: {
          toolUseId: "resolve", name: "resolve_place_candidates",
          input: { candidates: [{ name: "旭日酒造", sourceUrl: "https://tourism.example/izumo-sake" }] },
        } }] }, stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: [{ text: "出雲の旅程を保ったまま、旭日酒造を候補として地図に表示しました。" }] },
        stopReason: "end_turn",
      });

    const result = await runViewerAgentRuntime("酒蔵などはない？", {
      trains: [train], getPositions: () => [], getRouteTime: () => 1_200,
      setRouteTime: vi.fn(), focusTrain: vi.fn(), setLayerVisibility: vi.fn(),
      queryDailyCongestionAnalysis: vi.fn(), queryTrainDelayAnalysis: vi.fn(),
      getTripPlan: () => ({ ...tripPlanWithRailReturn(), destination: "出雲大社" }),
      searchWeb, readWebPages, searchPlaceMedia, maximumRouteTime: 1_800,
    }, converse);

    const availableTools = converse.mock.calls[0]?.[1]?.map(({ name }) => name) ?? [];
    expect(availableTools).toEqual(expect.arrayContaining([
      "ask_follow_up", "search_place_media", "search_web", "read_web_pages",
      "resolve_place_candidates", "propose_trip_update",
    ]));
    expect(availableTools).not.toContain("search_direct_routes");
    expect(searchWeb).toHaveBeenCalledOnce();
    expect(readWebPages).toHaveBeenCalledOnce();
    expect(searchPlaceMedia).toHaveBeenCalledWith({ query: "旭日酒造", limit: 3 });
    expect(typeof result).not.toBe("string");
    if (typeof result !== "string" && "external" in result) {
      expect(result.external?.places?.data?.places[0]?.name).toBe("旭日酒造");
    } else {
      throw new Error("外部スポット情報がありません。");
    }
  });
});

function previousJourneyToolConverse(input: Record<string, unknown>) {
  const name = input.action === "inspect_train" || input.action === "inspect_stops"
    ? "inspect_previous_journey"
    : "revise_previous_journey";
  return vi.fn<BedrockAgentConverse>(async () => ({
    message: {
      role: "assistant",
      content: [{
        toolUse: {
          toolUseId: "previous-journey",
          name,
          input,
        },
      }],
    },
    stopReason: "tool_use",
  }));
}

function previousJourneyWithStops(): import("../../domain/viewer-agent-response").ViewerAgentJourneyPlan {
  return {
    departureDate: "2026-08-15",
    serviceDate: "2026-08-15",
    originStation: "新大阪",
    destinationStation: "岡山",
    transferPace: "standard",
    rankingPreference: "balanced",
    maxTransfers: 3,
    searchTimeMinutes: 480,
    journeys: [{
      departureTimeMinutes: 480,
      arrivalTimeMinutes: 540,
      transferCount: 0,
      legs: [{
        serviceUid: "nozomi-99",
        trainNumber: "99A",
        serviceType: "新幹線",
        trainName: "のぞみ99号",
        originStation: "新大阪",
        destinationStation: "岡山",
        departureTimeMinutes: 480,
        arrivalTimeMinutes: 540,
        stops: [
          { stationName: "新大阪", departureTimeMinutes: 480 },
          { stationName: "新神戸", arrivalTimeMinutes: 492, departureTimeMinutes: 493 },
          { stationName: "岡山", arrivalTimeMinutes: 540 },
        ],
      }],
    }],
  };
}

function requireRichResponse(result: ViewerAgentResponse): ViewerAgentRichResponse {
  if (typeof result === "string" || !("journeyPlan" in result)) {
    throw new Error(`Expected a rich response but received: ${result}`);
  }
  return result;
}

function tripPlanWithRailReturn(): TripPlan {
  return {
    version: 1,
    id: "trip",
    title: "倉敷を巡る旅",
    destination: "倉敷",
    updatedAt: "2026-08-25T00:00:00Z",
    items: [{
      id: "return",
      type: "movement",
      mode: "rail",
      route: {
        departureDate: "2026-08-30",
        serviceDate: "2026-08-30",
        originStation: "倉敷",
        destinationStation: "摂津富田",
        searchTimeMinutes: 600,
        journeys: [{
          departureTimeMinutes: 600,
          arrivalTimeMinutes: 750,
          transferCount: 1,
          legs: [],
        }],
      },
    }],
  };
}
