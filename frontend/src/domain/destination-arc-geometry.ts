export interface ProjectedPoint { x: number; y: number; }
export interface DestinationArcVertex { x: number; y: number; z: number; }

const destinationArcHeightRatio = 0.16;
const maximumDestinationArcHeightMeters = 30_000;
const destinationArcEndpointHeightMeters = 8;

export function destinationArcHeightMeters(distanceMeters: number): number {
  return Math.min(
    Math.max(0, distanceMeters) * destinationArcHeightRatio,
    maximumDestinationArcHeightMeters,
  );
}

export function destinationArcVertex(
  start: ProjectedPoint,
  end: ProjectedPoint,
  progress: number,
  metersToProjectedUnits: number,
  arcHeightMeters: number,
  worldOrigin: ProjectedPoint,
): DestinationArcVertex {
  return {
    x: start.x + (end.x - start.x) * progress - worldOrigin.x,
    y: -(start.y + (end.y - start.y) * progress - worldOrigin.y),
    z:
      (destinationArcEndpointHeightMeters +
        Math.sin(Math.PI * progress) * arcHeightMeters) *
      metersToProjectedUnits,
  };
}
