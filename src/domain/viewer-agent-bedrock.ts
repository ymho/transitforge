import type {
  BedrockAgentContentBlock,
  BedrockAgentMessage,
  BedrockAgentResponse,
  BedrockAgentToolResultBlock,
  DailyCongestionPeakResponse,
} from "../data/bedrock-agent";
import type { Train } from "../data/train-index";
import type { SceneMode } from "./map-scene-mode";
import type { WeatherMode } from "./map-weather";
import type { TrainPosition } from "./train-position";
import {
  parseViewerAgentActions,
  type ViewerAgentLayer,
} from "./viewer-agent-action";
import {
  routeTimeFromPrompt,
  searchActiveTrainsFromPrompt,
} from "./viewer-agent-local-tools";

export interface BedrockViewerAgentDependencies {
  trains: Train[];
  getPositions: () => TrainPosition[];
  getRouteTime: () => number;
  setRouteTime: (routeTimeMinutes: number) => void;
  focusTrain: (serviceUid: string) => boolean;
  setWeather: (weather: WeatherMode) => void;
  setSceneMode: (mode: SceneMode) => void;
  setLayerVisibility: (layer: ViewerAgentLayer, visible: boolean) => void;
  queryDailyCongestionPeak: (
    serviceDate: string,
  ) => Promise<DailyCongestionPeakResponse>;
  maximumRouteTime: number;
}

export type BedrockAgentConverse = (
  messages: BedrockAgentMessage[],
) => Promise<BedrockAgentResponse>;

const maximumToolRounds = 6;

export async function runBedrockViewerAgent(
  prompt: string,
  dependencies: BedrockViewerAgentDependencies,
  converse: BedrockAgentConverse,
): Promise<string> {
  const messages: BedrockAgentMessage[] = [
    {
      role: "user",
      content: [
        {
          text:
            `利用者の依頼: ${prompt}\n` +
            `現在の表示時刻（0時からの分数）: ${dependencies.getRouteTime()}\n` +
            `日本時間の今日の日付: ${currentDateInJapan()}`,
        },
      ],
    },
  ];
  const searchableServiceUids = new Set<string>();

  for (let round = 0; round < maximumToolRounds; round += 1) {
    const response = await converse(messages);
    messages.push(response.message);
    const toolUses = response.message.content.filter(isToolUseBlock);

    if (toolUses.length === 0) {
      const text = response.message.content
        .filter(isTextBlock)
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n");
      return text || "案内を完了しました。";
    }

    const toolResults: BedrockAgentToolResultBlock[] = [];
    for (const { toolUse } of toolUses) {
      try {
        const result = await executeTool(
          toolUse.name,
          toolUse.input,
          prompt,
          dependencies,
          searchableServiceUids,
        );
        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId,
            status: "success",
            content: [{ json: result }],
          },
        });
      } catch (error) {
        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId,
            status: "error",
            content: [
              {
                json: {
                  message:
                    error instanceof Error
                      ? error.message
                      : "ツールを実行できませんでした。",
                },
              },
            ],
          },
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("AIの画面操作回数が上限を超えました。");
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  originalPrompt: string,
  dependencies: BedrockViewerAgentDependencies,
  searchableServiceUids: Set<string>,
): Promise<unknown> {
  if (name === "set_display_time") {
    const requestedTime = input.routeTimeMinutes;
    if (typeof requestedTime !== "number" || !Number.isFinite(requestedTime)) {
      throw new Error("表示時刻が不正です。");
    }
    const deterministicPromptTime = routeTimeFromPrompt(originalPrompt);
    const routeTimeMinutes = Math.min(
      Math.round(deterministicPromptTime ?? requestedTime),
      dependencies.maximumRouteTime,
    );
    const [action] = parseViewerAgentActions([
      { type: "set_display_time", routeTimeMinutes },
    ]);
    if (!action || action.type !== "set_display_time") {
      throw new Error("表示時刻を変更できません。");
    }
    dependencies.setRouteTime(action.routeTimeMinutes);
    searchableServiceUids.clear();
    return { routeTimeMinutes: action.routeTimeMinutes };
  }

  if (name === "search_trains") {
    const query = input.query;
    if (typeof query !== "string" || query.trim().length === 0) {
      throw new Error("列車の検索条件が必要です。");
    }
    const requestedLimit =
      typeof input.limit === "number" && Number.isInteger(input.limit)
        ? input.limit
        : 5;
    const limit = Math.max(1, Math.min(5, requestedLimit));
    const search = searchActiveTrainsFromPrompt(
      query,
      dependencies.trains,
      dependencies.getPositions(),
      dependencies.getRouteTime(),
      limit,
    );
    for (const { train } of search.matches) {
      searchableServiceUids.add(train.service_uid);
    }
    return {
      hasSearchTerms: search.hasSearchTerms,
      totalMatchCount: search.totalMatchCount,
      matches: search.matches.map(({ train }) => ({
        serviceUid: train.service_uid,
        trainNumber: train.train_no,
        serviceType: train.service_type,
        trainName: train.train_name,
        origin: train.origin_station,
        destination: train.destination_station,
      })),
    };
  }

  if (name === "focus_train") {
    const serviceUid = input.serviceUid;
    if (
      typeof serviceUid !== "string" ||
      !searchableServiceUids.has(serviceUid)
    ) {
      throw new Error("検索結果に含まれない列車は選択できません。");
    }
    const [action] = parseViewerAgentActions([
      { type: "focus_train", serviceUid },
    ]);
    if (
      !action ||
      action.type !== "focus_train" ||
      !dependencies.focusTrain(action.serviceUid)
    ) {
      throw new Error("列車の現在位置へ移動できませんでした。");
    }
    return { serviceUid, focused: true };
  }

  if (name === "query_daily_congestion_peak") {
    const serviceDate = input.serviceDate;
    if (
      typeof serviceDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
    ) {
      throw new Error("混雑履歴の日付が不正です。");
    }
    return dependencies.queryDailyCongestionPeak(serviceDate);
  }

  if (name === "set_weather") {
    const [action] = parseViewerAgentActions([
      { type: "set_weather", weather: input.weather },
    ]);
    if (!action || action.type !== "set_weather") {
      throw new Error("天気を変更できません。");
    }
    dependencies.setWeather(action.weather);
    return { weather: action.weather };
  }

  if (name === "set_scene_mode") {
    const [action] = parseViewerAgentActions([
      { type: "set_scene_mode", sceneMode: input.sceneMode },
    ]);
    if (!action || action.type !== "set_scene_mode") {
      throw new Error("表示モードを変更できません。");
    }
    dependencies.setSceneMode(action.sceneMode);
    return { sceneMode: action.sceneMode };
  }

  if (name === "set_layer_visibility") {
    const [action] = parseViewerAgentActions([
      {
        type: "set_layer_visibility",
        layer: input.layer,
        visible: input.visible,
      },
    ]);
    if (!action || action.type !== "set_layer_visibility") {
      throw new Error("表示レイヤーを変更できません。");
    }
    dependencies.setLayerVisibility(action.layer, action.visible);
    return { layer: action.layer, visible: action.visible };
  }

  throw new Error("許可されていないツールです。");
}

export function currentDateInJapan(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function isToolUseBlock(
  block: BedrockAgentContentBlock,
): block is Extract<BedrockAgentContentBlock, { toolUse: unknown }> {
  return "toolUse" in block;
}

function isTextBlock(
  block: BedrockAgentContentBlock,
): block is Extract<BedrockAgentContentBlock, { text: string }> {
  return "text" in block;
}
