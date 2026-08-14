import type { Train } from "../data/train-index";

export interface TrainFormationLink {
  partnerServiceUid: string;
  partnerTrainNo: string;
  partnerServiceType: string;
  linkKind: "coupled-service";
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
      linkKind: "coupled-service",
    });
  }

  return links;
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
