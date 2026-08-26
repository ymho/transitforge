import {
  nearestOriginWithDepartures,
  searchDirectRoutes,
  type DirectRouteSearchHandler,
  type JourneyRouteLeg,
} from "@raiquora/journey/direct-route-search";
import { journeyLegAlternativeFits } from "@raiquora/journey/journey-leg-alternative";
import type { JourneySearchService } from "@raiquora/journey/journey-search-service";
import type { StationCoordinate, StationLineCatalog } from "@raiquora/train/station";
import type { Train } from "@raiquora/train/train";

import type { JourneyLegAlternativeSearch } from "../../domain/journey-chat-follow-up";
import { isUsableOriginStation } from "../viewer/viewer-local-tools";

export interface JourneyLinePresentation {
  colorForStations(
    serviceType: string,
    destinationStation: string,
    stationNames: string[],
  ): { color: string; lineName: string };
}

export interface JourneySearchHandlerDependencies {
  trains: Train[];
  getDisplayTrains(): Train[];
  stationLineCatalog: StationLineCatalog;
  getDisplayedServiceDateStart(): Date;
  currentCoordinate(): Promise<StationCoordinate>;
  journeySearchService: JourneySearchService;
  linePresentation: JourneyLinePresentation;
}

export interface JourneySearchHandlers {
  localSearchRoutes: DirectRouteSearchHandler;
  backendSearchRoutes: DirectRouteSearchHandler;
  findJourneyLegAlternatives: JourneyLegAlternativeSearch;
}

export function createJourneySearchHandlers(
  dependencies: JourneySearchHandlerDependencies,
): JourneySearchHandlers {
  const resolveOrigin = async (
    request: Parameters<DirectRouteSearchHandler>[0],
  ) => {
    let originStation = isUsableOriginStation(request.originStation)
      ? request.originStation.trim()
      : undefined;
    let distanceMeters: number | undefined;
    if (!originStation) {
      const nearest = nearestOriginWithDepartures(
        dependencies.trains,
        dependencies.stationLineCatalog,
        request.departureTimeMinutes,
        await dependencies.currentCoordinate(),
      );
      if (!nearest) {
        throw new Error(
          "現在地の近くに出発可能な駅が見つかりません。出発駅を入力してください。",
        );
      }
      originStation = nearest.stationName;
      distanceMeters = nearest.distanceMeters;
    }
    return { originStation, distanceMeters };
  };

  const localSearchRoutes: DirectRouteSearchHandler = async (request) => {
    const { originStation, distanceMeters } = await resolveOrigin(request);
    const excludedServiceTypes = new Set(request.excludedServiceTypes ?? []);
    const excludedTrainNames = new Set(request.excludedTrainNames ?? []);
    const excludedTrainNumbers = new Set(request.excludedTrainNumbers ?? []);
    const excludedServiceUids = new Set(request.excludedServiceUids ?? []);
    const requiredServiceTypes = new Set(request.requiredServiceTypes ?? []);
    const requiredTrainNames = new Set(request.requiredTrainNames ?? []);
    const requiredTrainNumbers = new Set(request.requiredTrainNumbers ?? []);
    const allowedServiceTypes = new Set(request.allowedServiceTypes ?? []);
    const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "");
    const excluded = (train: Train) => {
      const trainName = normalize(train.train_name);
      const trainFamily = trainName.replace(/[0-9]+号$/u, "");
      const excludedByName = [...excludedTrainNames].some((value) => {
        const excludedName = normalize(value);
        return /[0-9]+号$/u.test(excludedName)
          ? trainName === excludedName
          : trainFamily === excludedName;
      });
      return excludedServiceTypes.has(train.service_type) || excludedByName ||
        excludedTrainNumbers.has(train.train_no) ||
        excludedServiceUids.has(train.service_uid);
    };
    const required = (train: Train) => {
      const trainName = normalize(train.train_name);
      const trainFamily = trainName.replace(/[0-9]+号$/u, "");
      const hasRequiredName = [...requiredTrainNames].every((value) => {
        const requiredName = normalize(value);
        return /[0-9]+号$/u.test(requiredName)
          ? trainName === requiredName
          : trainFamily === requiredName;
      });
      return [...requiredServiceTypes].every((value) => train.service_type === value) &&
        hasRequiredName &&
        [...requiredTrainNumbers].every((value) => train.train_no === value);
    };
    return {
      originStation,
      ...(excludedServiceTypes.size ? { excludedServiceTypes: [...excludedServiceTypes] } : {}),
      ...(excludedTrainNames.size ? { excludedTrainNames: [...excludedTrainNames] } : {}),
      ...(excludedTrainNumbers.size ? { excludedTrainNumbers: [...excludedTrainNumbers] } : {}),
      ...(excludedServiceUids.size ? { excludedServiceUids: [...excludedServiceUids] } : {}),
      ...(requiredServiceTypes.size ? { requiredServiceTypes: [...requiredServiceTypes] } : {}),
      ...(requiredTrainNames.size ? { requiredTrainNames: [...requiredTrainNames] } : {}),
      ...(requiredTrainNumbers.size ? { requiredTrainNumbers: [...requiredTrainNumbers] } : {}),
      ...(allowedServiceTypes.size ? { allowedServiceTypes: [...allowedServiceTypes] } : {}),
      ...(distanceMeters === undefined ? {} : { distanceMeters }),
      results: searchDirectRoutes(
        dependencies.getDisplayTrains().filter((train) =>
          !excluded(train) && required(train) &&
          (allowedServiceTypes.size === 0 || allowedServiceTypes.has(train.service_type))
        ),
        originStation,
        request.destinationStation,
        request.departureTimeMinutes,
      ),
    };
  };

  const backendSearchRoutes: DirectRouteSearchHandler = async (request) => {
    const { originStation, distanceMeters } = await resolveOrigin(request);
    const response = await dependencies.journeySearchService.search({
      serviceDate: request.serviceDate ?? formatServiceDate(
        dependencies.getDisplayedServiceDateStart(),
      ),
      originStation,
      destinationStation: request.destinationStation,
      departureTimeMinutes: request.departureTimeMinutes,
      limit: 3,
      maxTransfers: request.maxTransfers ?? 3,
      transferPace: request.transferPace,
      rankingPreference: request.rankingPreference,
      excludedServiceTypes: request.excludedServiceTypes,
      excludedTrainNames: request.excludedTrainNames,
      excludedTrainNumbers: request.excludedTrainNumbers,
      excludedServiceUids: request.excludedServiceUids,
      requiredServiceTypes: request.requiredServiceTypes,
      requiredTrainNames: request.requiredTrainNames,
      requiredTrainNumbers: request.requiredTrainNumbers,
      allowedServiceTypes: request.allowedServiceTypes,
    });
    const trainsByServiceUid = new Map(
      dependencies.getDisplayTrains().map((train) => [train.service_uid, train]),
    );
    return {
      originStation: response.originStation,
      serviceDate: response.serviceDate,
      ...(request.departureDate === undefined ? {} : { departureDate: request.departureDate }),
      transferPace: response.transferPace ?? request.transferPace,
      rankingPreference: response.rankingPreference ?? request.rankingPreference,
      maxTransfers: response.maxTransfers ?? request.maxTransfers,
      excludedServiceTypes: response.excludedServiceTypes ?? request.excludedServiceTypes,
      excludedTrainNames: response.excludedTrainNames ?? request.excludedTrainNames,
      excludedTrainNumbers: response.excludedTrainNumbers ?? request.excludedTrainNumbers,
      excludedServiceUids: response.excludedServiceUids ?? request.excludedServiceUids,
      requiredServiceTypes: response.requiredServiceTypes ?? request.requiredServiceTypes,
      requiredTrainNames: response.requiredTrainNames ?? request.requiredTrainNames,
      requiredTrainNumbers: response.requiredTrainNumbers ?? request.requiredTrainNumbers,
      allowedServiceTypes: response.allowedServiceTypes ?? request.allowedServiceTypes,
      ...(distanceMeters === undefined ? {} : { distanceMeters }),
      journeys: response.journeys.map((journey) => ({
        departureTimeMinutes: journey.departureTimeMinutes,
        arrivalTimeMinutes: journey.arrivalTimeMinutes,
        transferCount: journey.transferCount,
        legs: journey.legs.map(routeLeg),
      })),
      results: response.matches.flatMap((match) => {
        const train = trainsByServiceUid.get(match.serviceUid);
        return train ? [{
          train,
          originStation: match.originStation,
          destinationStation: match.destinationStation,
          departureTimeMinutes: match.departureTimeMinutes,
          arrivalTimeMinutes: match.arrivalTimeMinutes,
        }] : [];
      }),
    };
  };

  const routeLeg = (leg: JourneyRouteLeg): JourneyRouteLeg => {
    const line = dependencies.linePresentation.colorForStations(
      leg.serviceType,
      leg.destinationStation,
      leg.stops?.map((stop) => stop.stationName) ?? [
        leg.originStation,
        leg.destinationStation,
      ],
    );
    return { ...leg, lineName: line.lineName, lineColor: line.color };
  };

  const findJourneyLegAlternatives: JourneyLegAlternativeSearch = async ({
    plan,
    journey,
    startLegIndex,
    endLegIndex,
    requiredServiceTypes,
  }) => {
    const startLeg = journey.legs[startLegIndex];
    const endLeg = journey.legs[endLegIndex];
    if (!startLeg || !endLeg) return [];
    const response = await dependencies.journeySearchService.search({
      serviceDate: plan.serviceDate ?? formatServiceDate(
        dependencies.getDisplayedServiceDateStart(),
      ),
      originStation: startLeg.originStation,
      destinationStation: endLeg.destinationStation,
      departureTimeMinutes: startLeg.departureTimeMinutes,
      limit: 5,
      maxTransfers: 0,
      transferPace: plan.transferPace,
      rankingPreference: "earliest-arrival",
      ...(requiredServiceTypes.length ? { requiredServiceTypes } : {}),
    });
    return response.journeys
      .filter((candidate) => candidate.legs.length === 1)
      .map((candidate) => routeLeg(candidate.legs[0]))
      .filter((candidate) =>
        candidate.serviceUid !== startLeg.serviceUid &&
        journeyLegAlternativeFits(
          journey,
          startLegIndex,
          candidate,
          plan.transferPace,
          endLegIndex,
        )
      );
  };

  return { localSearchRoutes, backendSearchRoutes, findJourneyLegAlternatives };
}

export function formatServiceDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
