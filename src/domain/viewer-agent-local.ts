import type { Train } from "../data/train-index";
import type { DirectRouteSearchHandler } from "./direct-route-search";
import { directRouteDepartureTime } from "./direct-route-search";
import type { WeatherMode } from "./map-weather";
import { operatingDayStartMinutes } from "./playback";
import type { TrainPosition } from "./train-position";
import type { ViewerAgentLayer } from "./viewer-agent-action";
import {
  directRouteRequestFromPrompt,
  formatStationLabel,
  localViewerControlActionsFromPrompt,
  routeTimeFromPrompt,
  searchActiveTrainsFromPrompt,
  searchTrainArrivalsFromPrompt,
} from "./viewer-agent-local-tools";
import { trainTitleFor } from "../presentation/train-title";

export interface LocalViewerAgentDependencies {
  trains: Train[];
  getTrains?: () => Train[];
  getPositions: () => TrainPosition[];
  getRouteTime: () => number;
  setRouteTime: (routeTimeMinutes: number) => void;
  focusTrain: (serviceUid: string) => boolean;
  setWeather: (weather: WeatherMode) => void;
  setLayerVisibility: (layer: ViewerAgentLayer, visible: boolean) => void;
  searchDirectRoutes: DirectRouteSearchHandler;
  maximumRouteTime: number;
}

export function createLocalViewerAgent(
  dependencies: LocalViewerAgentDependencies,
): (prompt: string) => Promise<string> {
  return async (prompt) => {
    const responseParts = applyControlActions(prompt, dependencies);
    const arrivalResponse = arrivalSearchResponse(prompt, dependencies);
    if (arrivalResponse !== undefined) {
      return [...responseParts, arrivalResponse].join("\n");
    }

    const directRouteResponse = await directRouteSearchResponse(
      prompt,
      dependencies,
    );
    if (directRouteResponse !== undefined) {
      return [...responseParts, directRouteResponse].join("\n");
    }

    const requestedRouteTime = routeTimeFromPrompt(prompt);
    if (requestedRouteTime !== undefined) {
      const routeTime = Math.min(
        requestedRouteTime,
        dependencies.maximumRouteTime,
      );
      dependencies.setRouteTime(routeTime);
      responseParts.push(`表示時刻を${formatRouteTime(routeTime)}に変更しました。`);
    }

    const routeTime = dependencies.getRouteTime();
    const search = searchActiveTrainsFromPrompt(
      prompt,
      currentTrains(dependencies),
      dependencies.getPositions(),
      routeTime,
    );
    if (search.hasSearchTerms) {
      const first = search.matches[0];
      if (!first) {
        responseParts.push(
          `${formatRouteTime(routeTime)}に運行中の条件に合う列車は見つかりませんでした。`,
        );
      } else {
        const focused = dependencies.focusTrain(first.train.service_uid);
        const title = trainTitleFor(first.train);
        const fullTitle = `${title.main}${title.suffix ?? ""}`;
        responseParts.push(
          focused
            ? `${fullTitle}を選択し、列車の位置へ移動しました。`
            : `${fullTitle}は見つかりましたが、現在位置へ移動できませんでした。`,
        );
        if (search.totalMatchCount > 1) {
          responseParts.push(
            `条件に合う列車はほかに${search.totalMatchCount - 1}件あります。`,
          );
        }
      }
    }

    return responseParts.length > 0
      ? responseParts.join("\n")
      : "時刻、駅名、列車種別、列車名、列車番号を含めて依頼してください。例:「18時30分に京都へ向かう特急を見せて」";
  };
}

function applyControlActions(
  prompt: string,
  dependencies: LocalViewerAgentDependencies,
): string[] {
  const responseParts: string[] = [];
  for (const action of localViewerControlActionsFromPrompt(prompt)) {
    if (action.type === "set_weather") {
      dependencies.setWeather(action.weather);
      const weatherLabel = {
        clear: "晴れ",
        cloudy: "曇り",
        rain: "雨",
        snow: "雪",
      }[action.weather];
      responseParts.push(`天気を${weatherLabel}に設定しました。`);
    } else if (action.type === "set_layer_visibility") {
      dependencies.setLayerVisibility(action.layer, action.visible);
      const layerLabel =
        action.layer === "congestion" ? "混雑棒" : "目的地アーチ";
      responseParts.push(
        `${layerLabel}を${action.visible ? "表示" : "非表示に"}しました。`,
      );
    }
  }
  return responseParts;
}

function arrivalSearchResponse(
  prompt: string,
  dependencies: LocalViewerAgentDependencies,
): string | undefined {
  const search = searchTrainArrivalsFromPrompt(prompt, currentTrains(dependencies));
  if (!search.hasSearchTerms || search.targetTimeMinutes === undefined) {
    return undefined;
  }
  const rangeStart = Math.max(
    operatingDayStartMinutes,
    search.targetTimeMinutes - search.windowMinutes,
  );
  const rangeEnd = Math.min(
    dependencies.maximumRouteTime,
    search.targetTimeMinutes + search.windowMinutes,
  );
  if (search.matches.length === 0) {
    return `${formatRouteTime(rangeStart)}〜${formatRouteTime(rangeEnd)}に条件に合う到着列車は見つかりませんでした。`;
  }
  const arrivals = search.matches.map(({ train, arrivalTimeMinutes }) => {
    const title = trainTitleFor(train);
    return `${formatRouteTime(arrivalTimeMinutes)} ${title.main}${title.suffix ?? ""}`;
  });
  const remaining = search.totalMatchCount - search.matches.length;
  return [
    `${formatRouteTime(rangeStart)}〜${formatRouteTime(rangeEnd)}の到着列車です。`,
    ...arrivals,
    ...(remaining > 0 ? [`ほかに${remaining}件あります。`] : []),
  ].join("\n");
}

async function directRouteSearchResponse(
  prompt: string,
  dependencies: LocalViewerAgentDependencies,
): Promise<string | undefined> {
  const request = directRouteRequestFromPrompt(prompt, currentTrains(dependencies));
  if (!request) {
    return undefined;
  }
  const departureTimeMinutes = directRouteDepartureTime(
    request.departureTimeMinutes,
    dependencies.getRouteTime(),
    dependencies.maximumRouteTime,
  );
  try {
    const response = await dependencies.searchDirectRoutes({
      ...request,
      departureTimeMinutes,
    });
    const first = response.results[0];
    if (!first) {
      return `${formatRouteTime(departureTimeMinutes)}以降に${formatStationLabel(response.originStation)}から${formatStationLabel(request.destinationStation)}へ直通する列車は見つかりませんでした。`;
    }
    const focused = dependencies.focusTrain(first.train.service_uid);
    const routes = response.results.map((route, index) => {
      const title = trainTitleFor(route.train);
      return `${index + 1}. ${formatRouteTime(route.departureTimeMinutes)} ${route.originStation}発 → ${formatRouteTime(route.arrivalTimeMinutes)} ${route.destinationStation}着 ${title.main}${title.suffix ?? ""}`;
    });
    const focusMessage = focused
      ? "先頭の列車の現在位置を選択しました。"
      : "先頭の列車はまだ運行開始前のため、経路のみ案内します。";
    return `${formatStationLabel(response.originStation)}から${formatStationLabel(request.destinationStation)}への直通列車です。${focusMessage}\n${routes.join("\n")}`;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "直通経路を検索できませんでした。出発駅を入力してください。";
  }
}

function currentTrains(dependencies: LocalViewerAgentDependencies): Train[] {
  return dependencies.getTrains?.() ?? dependencies.trains;
}

function formatRouteTime(routeTimeMinutes: number): string {
  const totalSeconds = Math.round(routeTimeMinutes * 60);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const base = `${hours}時${String(minutes).padStart(2, "0")}分`;
  return seconds === 0 ? base : `${base}${String(seconds).padStart(2, "0")}秒`;
}
