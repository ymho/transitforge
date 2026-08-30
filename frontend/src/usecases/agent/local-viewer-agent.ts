import type { Train } from "@raiquora/train/train";
import type { DirectRouteSearchHandler } from "@raiquora/journey/direct-route-search";
import { directRouteDepartureTime } from "@raiquora/journey/direct-route-search";
import {
  journeyNavigationGuidanceFromPrompt,
  mergeJourneyNavigationGuidance,
  type JourneyNavigationGuidance,
} from "../../domain/journey-navigation-intent";
import { operatingDayStartMinutes } from "../../domain/playback";
import { formatJapaneseServiceTime } from "@raiquora/train/route-time";
import type { TrainPosition } from "../../domain/train-position";
import type { ViewerAgentLayer } from "../viewer/viewer-action";
import {
  directRouteRequestFromPrompt,
  formatStationLabel,
  localViewerControlActionsFromPrompt,
  routeTimeFromPrompt,
  searchActiveTrainsFromPrompt,
  searchTrainArrivalsFromPrompt,
} from "../viewer/viewer-local-tools";

export interface LocalViewerAgentDependencies {
  trains: Train[];
  getTrains?: () => Train[];
  getPositions: () => TrainPosition[];
  getRouteTime: () => number;
  setRouteTime: (routeTimeMinutes: number) => void;
  focusTrain: (serviceUid: string) => boolean;
  setLayerVisibility: (layer: ViewerAgentLayer, visible: boolean) => void;
  searchDirectRoutes: DirectRouteSearchHandler;
  getPendingJourneyGuidance?: () => JourneyNavigationGuidance | undefined;
  formatTrainTitle?: (train: Train) => string;
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
      responseParts.push(`表示時刻を${formatJapaneseServiceTime(routeTime)}に変更しました。`);
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
          `${formatJapaneseServiceTime(routeTime)}に運行中の条件に合う列車は見つかりませんでした。`,
        );
      } else {
        const focused = dependencies.focusTrain(first.train.service_uid);
        const fullTitle = formatTrainTitle(first.train, dependencies);
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
    if (action.type === "set_layer_visibility") {
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
    return `${formatJapaneseServiceTime(rangeStart)}〜${formatJapaneseServiceTime(rangeEnd)}に条件に合う到着列車は見つかりませんでした。`;
  }
  const arrivals = search.matches.map(({ train, arrivalTimeMinutes }) => {
    return `${formatJapaneseServiceTime(arrivalTimeMinutes)} ${formatTrainTitle(train, dependencies)}`;
  });
  const remaining = search.totalMatchCount - search.matches.length;
  return [
    `${formatJapaneseServiceTime(rangeStart)}〜${formatJapaneseServiceTime(rangeEnd)}の到着列車です。`,
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
  const guidance = mergeJourneyNavigationGuidance(
    dependencies.getPendingJourneyGuidance?.(),
    journeyNavigationGuidanceFromPrompt(prompt, dependencies.trains),
  );
  try {
    const response = await dependencies.searchDirectRoutes({
      ...request,
      departureTimeMinutes,
      ...(guidance.transferPace
        ? { transferPace: guidance.transferPace }
        : {}),
      ...(guidance.rankingPreference
        ? { rankingPreference: guidance.rankingPreference }
        : {}),
      ...(guidance.maxTransfers === undefined
        ? {}
        : { maxTransfers: guidance.maxTransfers }),
      ...(guidance.requiredServiceTypes.length
        ? { requiredServiceTypes: guidance.requiredServiceTypes }
        : {}),
      ...(guidance.requiredTrainNames.length
        ? { requiredTrainNames: guidance.requiredTrainNames }
        : {}),
      ...(guidance.requiredTrainNumbers.length
        ? { requiredTrainNumbers: guidance.requiredTrainNumbers }
        : {}),
      ...(guidance.allowedServiceTypes.length
        ? { allowedServiceTypes: guidance.allowedServiceTypes }
        : {}),
      ...(guidance.excludedServiceTypes.length
        ? { excludedServiceTypes: guidance.excludedServiceTypes }
        : {}),
      ...(guidance.excludedTrainNames.length
        ? { excludedTrainNames: guidance.excludedTrainNames }
        : {}),
      ...(guidance.excludedTrainNumbers.length
        ? { excludedTrainNumbers: guidance.excludedTrainNumbers }
        : {}),
    });
    const first = response.results[0];
    if (!first) {
      return `${formatJapaneseServiceTime(departureTimeMinutes)}以降に${formatStationLabel(response.originStation)}から${formatStationLabel(request.destinationStation)}へ直通する列車は見つかりませんでした。`;
    }
    const focused = dependencies.focusTrain(first.train.service_uid);
    const routes = response.results.map((route, index) => {
      return `${index + 1}. ${formatJapaneseServiceTime(route.departureTimeMinutes)} ${route.originStation}発 → ${formatJapaneseServiceTime(route.arrivalTimeMinutes)} ${route.destinationStation}着 ${formatTrainTitle(route.train, dependencies)}`;
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

function formatTrainTitle(
  train: Train,
  dependencies: LocalViewerAgentDependencies,
): string {
  return dependencies.formatTrainTitle?.(train) ??
    [train.service_type, train.train_name, train.train_no]
      .filter((part) => part.trim().length > 0)
      .join(" ");
}

function currentTrains(dependencies: LocalViewerAgentDependencies): Train[] {
  return dependencies.getTrains?.() ?? dependencies.trains;
}
