import type { TrainPosition } from "./train-position";
import type { TrainFormationLink } from "./train-formation-link";

export interface TrainRenderLayout {
  position: TrainPosition;
  renderCoordinate: [number, number];
  renderBearingRadians: number;
  bearingTrackingKey: string;
  overlapOffsetMeters: {
    longitudinal: number;
    lateral: number;
    vertical: number;
  };
  lengthScale: number;
  longitudinalOffsetInVehicleLengths: number;
  coupledServiceUid?: string;
  linkKind?: TrainLinkKind;
}

export type TrainLinkKind = "same-operation" | "coupled-service";

const maximumCouplingDistanceMeters = 20;
const maximumBearingDifferenceRadians = Math.PI / 12;

export function coupledTrainLayouts(
  positions: TrainPosition[],
  formationLinks: ReadonlyMap<string, TrainFormationLink> = new Map(),
): TrainRenderLayout[] {
  const linkedPositions = positionsWithFormationPartners(
    positions,
    formationLinks,
  );
  const layouts = new Map<string, Omit<TrainRenderLayout, "position">>();
  const pairedServiceUids = new Set<string>();

  for (const train of linkedPositions) {
    const link = formationLinks.get(train.serviceUid);
    const partner = link
      ? linkedPositions.find(
          ({ serviceUid }) => serviceUid === link.partnerServiceUid,
        )
      : undefined;
    if (
      !link ||
      !partner ||
      !formationLinkIsActive(link, train) ||
      pairedServiceUids.has(train.serviceUid)
    ) {
      continue;
    }

    setLinkedLayouts(layouts, train, partner, link.linkKind);
    pairedServiceUids.add(train.serviceUid);
    pairedServiceUids.add(partner.serviceUid);
  }

  // A single physical train can be split into multiple timetable services.
  // Train numbers are not globally unique, so only join entries that are also
  // at the same place and moving in the same direction.
  for (const train of [...linkedPositions].sort(compareServiceUid)) {
    if (pairedServiceUids.has(train.serviceUid)) {
      continue;
    }

    const partner = closestMatchingPosition(
      train,
      linkedPositions.filter(
        (candidate) =>
          candidate.serviceUid !== train.serviceUid &&
          !pairedServiceUids.has(candidate.serviceUid) &&
          candidate.trainNo === train.trainNo,
      ),
    );
    if (!partner) {
      continue;
    }

    setLinkedLayouts(layouts, train, partner, "same-operation");
    pairedServiceUids.add(train.serviceUid);
    pairedServiceUids.add(partner.serviceUid);
  }

  const kansaiAirportRapid = linkedPositions
    .filter(
      ({ serviceUid, serviceType }) =>
        !pairedServiceUids.has(serviceUid) && serviceType.includes("関空快速"),
    )
    .sort(compareServiceUid);
  const kishujiRapid = linkedPositions
    .filter(
      ({ serviceUid, serviceType }) =>
        !pairedServiceUids.has(serviceUid) && serviceType.includes("紀州路快速"),
    )
    .sort(compareServiceUid);

  for (const airportTrain of kansaiAirportRapid) {
    if (pairedServiceUids.has(airportTrain.serviceUid)) {
      continue;
    }
    const airportNumber = numericTrainNumber(airportTrain.trainNo);
    if (airportNumber === undefined) {
      continue;
    }

    const partner = kishujiRapid
      .filter(({ serviceUid }) => !pairedServiceUids.has(serviceUid))
      .map((candidate) => ({
        candidate,
        distance: distanceInMeters(airportTrain.coordinate, candidate.coordinate),
      }))
      .filter(({ candidate, distance }) => {
        const candidateNumber = numericTrainNumber(candidate.trainNo);
        return (
          candidateNumber !== undefined &&
          Math.abs(airportNumber - candidateNumber) === 400 &&
          distance <= maximumCouplingDistanceMeters &&
          bearingDifference(
            airportTrain.bearingRadians,
            candidate.bearingRadians,
          ) <= maximumBearingDifferenceRadians
        );
      })
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;

    if (!partner) {
      continue;
    }

    setLinkedLayouts(layouts, airportTrain, partner, "coupled-service");
    pairedServiceUids.add(airportTrain.serviceUid);
    pairedServiceUids.add(partner.serviceUid);
  }

  return withOverlapOffsets(linkedPositions.map((position) => ({
    position,
    renderCoordinate:
      layouts.get(position.serviceUid)?.renderCoordinate ?? position.coordinate,
    renderBearingRadians:
      layouts.get(position.serviceUid)?.renderBearingRadians ??
      position.bearingRadians,
    bearingTrackingKey:
      layouts.get(position.serviceUid)?.bearingTrackingKey ??
      position.serviceUid,
    overlapOffsetMeters:
      layouts.get(position.serviceUid)?.overlapOffsetMeters ??
      zeroOverlapOffset(),
    lengthScale: layouts.get(position.serviceUid)?.lengthScale ?? 1,
    longitudinalOffsetInVehicleLengths:
      layouts.get(position.serviceUid)?.longitudinalOffsetInVehicleLengths ?? 0,
    coupledServiceUid: layouts.get(position.serviceUid)?.coupledServiceUid,
    linkKind: layouts.get(position.serviceUid)?.linkKind,
  })));
}

function positionsWithFormationPartners(
  positions: TrainPosition[],
  formationLinks: ReadonlyMap<string, TrainFormationLink>,
): TrainPosition[] {
  const result = [...positions];
  const visibleServiceUids = new Set(
    positions.map(({ serviceUid }) => serviceUid),
  );

  for (const position of positions) {
    const link = formationLinks.get(position.serviceUid);
    if (
      !link ||
      !formationLinkIsActive(link, position) ||
      visibleServiceUids.has(link.partnerServiceUid)
    ) {
      continue;
    }
    result.push({
      ...position,
      serviceUid: link.partnerServiceUid,
      trainNo: link.partnerTrainNo,
      serviceType: link.partnerServiceType,
    });
    visibleServiceUids.add(link.partnerServiceUid);
  }

  return result;
}

function formationLinkIsActive(
  link: TrainFormationLink,
  position: TrainPosition,
): boolean {
  const range = link.activeRouteMeterRange;
  return (
    !range ||
    (position.routeMeter >= range[0] && position.routeMeter <= range[1])
  );
}

function closestMatchingPosition(
  train: TrainPosition,
  candidates: TrainPosition[],
): TrainPosition | undefined {
  return candidates
    .map((candidate) => ({
      candidate,
      distance: distanceInMeters(train.coordinate, candidate.coordinate),
    }))
    .filter(
      ({ candidate, distance }) =>
        distance <= maximumCouplingDistanceMeters &&
        bearingDifference(train.bearingRadians, candidate.bearingRadians) <=
          maximumBearingDifferenceRadians,
    )
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        compareServiceUid(left.candidate, right.candidate),
    )[0]?.candidate;
}

function setLinkedLayouts(
  layouts: Map<string, Omit<TrainRenderLayout, "position">>,
  first: TrainPosition,
  second: TrainPosition,
  linkKind: TrainLinkKind,
): void {
  const [front, rear] = [first, second].sort(compareServiceUid);
  const renderCoordinate = midpoint(front.coordinate, rear.coordinate);
  const renderBearingRadians = averageBearing(
    front.bearingRadians,
    rear.bearingRadians,
  );
  const bearingTrackingKey = [front.serviceUid, rear.serviceUid].join("|");

  layouts.set(front.serviceUid, {
    renderCoordinate,
    renderBearingRadians,
    bearingTrackingKey,
    overlapOffsetMeters: zeroOverlapOffset(),
    lengthScale: 0.5,
    longitudinalOffsetInVehicleLengths: 0.25,
    coupledServiceUid: rear.serviceUid,
    linkKind,
  });
  layouts.set(rear.serviceUid, {
    renderCoordinate,
    renderBearingRadians,
    bearingTrackingKey,
    overlapOffsetMeters: zeroOverlapOffset(),
    lengthScale: 0.5,
    longitudinalOffsetInVehicleLengths: -0.25,
    coupledServiceUid: front.serviceUid,
    linkKind,
  });
}

function withOverlapOffsets(layouts: TrainRenderLayout[]): TrainRenderLayout[] {
  const visualGroups = new Map<
    string,
    { coordinate: [number, number]; bearingRadians: number }
  >();
  for (const layout of layouts) {
    visualGroups.set(layout.bearingTrackingKey, {
      coordinate: layout.renderCoordinate,
      bearingRadians: layout.renderBearingRadians,
    });
  }

  const trackingKeysByOverlapCell = new Map<string, string[]>();
  for (const [trackingKey, visualGroup] of visualGroups) {
    const cell = overlapCellFor(
      visualGroup.coordinate,
      visualGroup.bearingRadians,
    );
    const trackingKeys = trackingKeysByOverlapCell.get(cell) ?? [];
    trackingKeys.push(trackingKey);
    trackingKeysByOverlapCell.set(cell, trackingKeys);
  }

  const offsetsByTrackingKey = new Map<
    string,
    TrainRenderLayout["overlapOffsetMeters"]
  >();
  for (const trackingKeys of trackingKeysByOverlapCell.values()) {
    if (trackingKeys.length < 2) {
      continue;
    }

    trackingKeys.sort();
    const centerIndex = (trackingKeys.length - 1) / 2;
    trackingKeys.forEach((trackingKey, index) => {
      const slot = index - centerIndex;
      offsetsByTrackingKey.set(trackingKey, {
        longitudinal: slot * 0.12,
        lateral: slot * 0.1,
        vertical: index * 0.08,
      });
    });
  }

  return layouts.map((layout) => ({
    ...layout,
    overlapOffsetMeters:
      offsetsByTrackingKey.get(layout.bearingTrackingKey) ??
      layout.overlapOffsetMeters,
  }));
}

function overlapCellFor(
  coordinate: [number, number],
  bearingRadians: number,
): string {
  return [
    Math.round(coordinate[0] * 100_000),
    Math.round(coordinate[1] * 100_000),
    Math.round(Math.sin(bearingRadians) * 50),
    Math.round(Math.cos(bearingRadians) * 50),
  ].join(":");
}

function zeroOverlapOffset(): TrainRenderLayout["overlapOffsetMeters"] {
  return { longitudinal: 0, lateral: 0, vertical: 0 };
}

function midpoint(
  left: [number, number],
  right: [number, number],
): [number, number] {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

function averageBearing(left: number, right: number): number {
  return Math.atan2(
    Math.sin(left) + Math.sin(right),
    Math.cos(left) + Math.cos(right),
  );
}

function numericTrainNumber(trainNumber: string): number | undefined {
  const match = /^(\d+)/u.exec(trainNumber);
  return match ? Number(match[1]) : undefined;
}

function compareServiceUid(left: TrainPosition, right: TrainPosition): number {
  return left.serviceUid.localeCompare(right.serviceUid);
}

function bearingDifference(left: number, right: number): number {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

function distanceInMeters(
  from: [number, number],
  to: [number, number],
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDifference = toRadians(to[1] - from[1]);
  const longitudeDifference = toRadians(to[0] - from[0]);
  const fromLatitude = toRadians(from[1]);
  const toLatitude = toRadians(to[1]);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;

  return (
    2 *
    earthRadiusMeters *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}
