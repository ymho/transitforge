import type { Train } from "../data/train-index";

export interface TrainFormationLink {
  partnerServiceUid: string;
  partnerTrainNo: string;
  partnerServiceType: string;
  linkKind: "coupled-service" | "same-operation";
  activeRouteMeterRange?: readonly [number, number];
}

const maibaraStation = "米原";
const maximumConnectionMinutes = 10;

/**
 * 米原で一部編成だけが北陸本線へ直通する新快速を関連付ける
 *
 * 34xxMが京阪神側の編成全体 32xxMが米原以北へ進む一部編成を表す
 * 表示上の併結は34xxMの運行区間だけに適用する
 */
export function trainFormationLinks(
  trains: Train[],
): ReadonlyMap<string, TrainFormationLink> {
  const links = new Map<string, TrainFormationLink>();
  addKansaiAirportKishujiLinks(trains, links);
  const northernSectionsBySuffix = new Map<string, Train[]>();

  for (const train of trains) {
    const match = /^32(\d{2})M$/u.exec(train.train_no);
    if (!match || train.service_type !== "新快速") {
      continue;
    }
    const sections = northernSectionsBySuffix.get(match[1]) ?? [];
    sections.push(train);
    northernSectionsBySuffix.set(match[1], sections);
  }

  for (const mainSection of trains) {
    const match = /^34(\d{2})M$/u.exec(mainSection.train_no);
    if (!match || mainSection.service_type !== "新快速") {
      continue;
    }

    const partner = (northernSectionsBySuffix.get(match[1]) ?? [])
      .map((candidate) => ({
        candidate,
        gap: maibaraConnectionGap(mainSection, candidate),
      }))
      .filter(
        (item): item is { candidate: Train; gap: number } =>
          item.gap !== undefined &&
          item.gap >= 0 &&
          item.gap <= maximumConnectionMinutes,
      )
      .sort(
        (left, right) =>
          left.gap - right.gap ||
          left.candidate.service_uid.localeCompare(right.candidate.service_uid),
      )[0]?.candidate;
    if (!partner) {
      continue;
    }

    links.set(mainSection.service_uid, {
      partnerServiceUid: partner.service_uid,
      partnerTrainNo: partner.train_no,
      partnerServiceType: partner.service_type,
      // 時刻表上で分割された同一列車として詳細は1本にまとめる
      linkKind: "same-operation",
    });
  }

  return links;
}

function addKansaiAirportKishujiLinks(
  trains: Train[],
  links: Map<string, TrainFormationLink>,
): void {
  const kishujiByNumber = new Map<number, Train[]>();
  for (const train of trains) {
    const number = numericTrainNumber(train.train_no);
    if (number === undefined || !train.service_type.includes("紀州路快速")) {
      continue;
    }
    const candidates = kishujiByNumber.get(number) ?? [];
    candidates.push(train);
    kishujiByNumber.set(number, candidates);
  }

  for (const airportTrain of trains) {
    const airportNumber = numericTrainNumber(airportTrain.train_no);
    if (
      airportNumber === undefined ||
      !airportTrain.service_type.includes("関空快速")
    ) {
      continue;
    }
    const partnerMatch = (kishujiByNumber.get(airportNumber + 400) ?? [])
      .map((candidate) => ({
        candidate,
        sharedStopTimes: sharedStopTimes(airportTrain, candidate),
      }))
      .filter(({ sharedStopTimes }) => sharedStopTimes.size >= 2)
      .sort((left, right) =>
        left.candidate.service_uid.localeCompare(right.candidate.service_uid),
      )[0];
    const partner = partnerMatch?.candidate;
    if (!partner) {
      continue;
    }
    links.set(
      airportTrain.service_uid,
      formationLinkFor(
        partner,
        sharedRouteMeterRange(airportTrain, partnerMatch.sharedStopTimes),
      ),
    );
    links.set(
      partner.service_uid,
      formationLinkFor(
        airportTrain,
        sharedRouteMeterRange(partner, partnerMatch.sharedStopTimes),
      ),
    );
  }
}

function formationLinkFor(
  partner: Train,
  activeRouteMeterRange?: readonly [number, number],
): TrainFormationLink {
  return {
    partnerServiceUid: partner.service_uid,
    partnerTrainNo: partner.train_no,
    partnerServiceType: partner.service_type,
    linkKind: "coupled-service",
    ...(activeRouteMeterRange ? { activeRouteMeterRange } : {}),
  };
}

function sharedStopTimes(left: Train, right: Train): ReadonlySet<string> {
  const rightStopTimes = new Set(
    right.stops.map((stop) => `${stop.station_name}:${stop.route_time_minutes}`),
  );
  return new Set(
    left.stops
      .map((stop) => `${stop.station_name}:${stop.route_time_minutes}`)
      .filter((key) => rightStopTimes.has(key)),
  );
}

function sharedRouteMeterRange(
  train: Train,
  sharedStopTimes: ReadonlySet<string>,
): readonly [number, number] | undefined {
  const routeMeters = train.stops.flatMap((stop) =>
    typeof stop.route_meter === "number" &&
    sharedStopTimes.has(`${stop.station_name}:${stop.route_time_minutes}`)
      ? [stop.route_meter]
      : [],
  );
  return routeMeters.length > 0
    ? [Math.min(...routeMeters), Math.max(...routeMeters)]
    : undefined;
}

function numericTrainNumber(trainNumber: string): number | undefined {
  const match = /^(\d+)/u.exec(trainNumber);
  return match ? Number(match[1]) : undefined;
}

function maibaraConnectionGap(
  mainSection: Train,
  northernSection: Train,
): number | undefined {
  if (
    mainSection.destination_station === maibaraStation &&
    northernSection.origin_station === maibaraStation
  ) {
    return minutesBetween(mainSection, northernSection);
  }
  if (
    northernSection.destination_station === maibaraStation &&
    mainSection.origin_station === maibaraStation
  ) {
    return minutesBetween(northernSection, mainSection);
  }
  return undefined;
}

function minutesBetween(arriving: Train, departing: Train): number | undefined {
  const arrival = arriving.stops.at(-1)?.route_time_minutes;
  const departure = departing.stops[0]?.route_time_minutes;
  return typeof arrival === "number" && typeof departure === "number"
    ? departure - arrival
    : undefined;
}
