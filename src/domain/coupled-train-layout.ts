import type { TrainPosition } from "./train-position";

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
}

const maximumCouplingDistanceMeters = 20;
const maximumBearingDifferenceRadians = Math.PI / 12;

export function coupledTrainLayouts(
  positions: TrainPosition[],
): TrainRenderLayout[] {
  const layouts = new Map<string, Omit<TrainRenderLayout, "position">>();
  const kansaiAirportRapid = positions
    .filter(({ serviceType }) => serviceType.includes("関空快速"))
    .sort(compareServiceUid);
  const kishujiRapid = positions
    .filter(({ serviceType }) => serviceType.includes("紀州路快速"))
    .sort(compareServiceUid);
  const pairedKishujiServiceUids = new Set<string>();

  for (const airportTrain of kansaiAirportRapid) {
    const airportNumber = numericTrainNumber(airportTrain.trainNo);
    if (airportNumber === undefined) {
      continue;
    }

    const partner = kishujiRapid
      .filter(({ serviceUid }) => !pairedKishujiServiceUids.has(serviceUid))
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

    pairedKishujiServiceUids.add(partner.serviceUid);
    const renderCoordinate = midpoint(
      airportTrain.coordinate,
      partner.coordinate,
    );
    const renderBearingRadians = averageBearing(
      airportTrain.bearingRadians,
      partner.bearingRadians,
    );
    const bearingTrackingKey = [airportTrain.serviceUid, partner.serviceUid]
      .sort()
      .join("|");
    layouts.set(airportTrain.serviceUid, {
      renderCoordinate,
      renderBearingRadians,
      bearingTrackingKey,
      overlapOffsetMeters: zeroOverlapOffset(),
      lengthScale: 0.5,
      longitudinalOffsetInVehicleLengths: 0.25,
      coupledServiceUid: partner.serviceUid,
    });
    layouts.set(partner.serviceUid, {
      renderCoordinate,
      renderBearingRadians,
      bearingTrackingKey,
      overlapOffsetMeters: zeroOverlapOffset(),
      lengthScale: 0.5,
      longitudinalOffsetInVehicleLengths: -0.25,
      coupledServiceUid: airportTrain.serviceUid,
    });
  }

  return withOverlapOffsets(positions.map((position) => ({
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
  })));
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
