import { describe, expect, it } from "vitest";
import type { Path } from "@raiquora/train/path";
import { prioritizeStartupPaths } from "./route-startup-priority";
const path = (id: string, bbox: Path["bbox"]): Path => ({ path_id: id, bbox, coord_count: 2, route_length_m: 100, route_coords: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]] });
describe("startup route priority", () => {
  it("prioritizes crossing long routes and nearby routes without dropping or mutating input", () => {
    const distant = path("far", [130, 30, 131, 31]);
    const long = path("long", [134, 34, 137, 36]);
    const nearby = path("near", [136.1, 35, 136.2, 35.1]);
    const paths = [distant, long, nearby];
    expect(prioritizeStartupPaths(paths, [135, 34, 136, 35])).toEqual([long, nearby, distant]);
    expect(paths).toEqual([distant, long, nearby]);
  });
  it("handles empty inputs and preserves within-group order", () => {
    expect(prioritizeStartupPaths([], [135, 34, 136, 35])).toEqual([]);
    const paths = [path("a", [130, 30, 131, 31]), path("b", [140, 40, 141, 41])];
    expect(prioritizeStartupPaths(paths, [135, 34, 136, 35])).toEqual(paths);
  });
});
