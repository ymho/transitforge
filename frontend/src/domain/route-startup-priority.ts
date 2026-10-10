import type { BoundingBox, Path } from "@raiquora/train/path";

/** Stable partition: keep every route, including long routes crossing the viewport. */
export function prioritizeStartupPaths(paths: Path[], bounds: BoundingBox): Path[] {
  const [west, south, east, north] = bounds;
  const longitudeMargin = (east - west) * 0.25;
  const latitudeMargin = (north - south) * 0.25;
  const nearby: Path[] = [], remaining: Path[] = [];
  for (const path of paths) {
    const [minX, minY, maxX, maxY] = path.bbox;
    const overlaps = maxX >= west - longitudeMargin && minX <= east + longitudeMargin &&
      maxY >= south - latitudeMargin && minY <= north + latitudeMargin;
    (overlaps ? nearby : remaining).push(path);
  }
  return [...nearby, ...remaining];
}
