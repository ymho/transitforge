import { describe, it, expect } from "vitest";
import { placeCameraOffset } from "./place-camera-offset";
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
describe("place camera visible area", () => {
  it("reserves desktop detail and list space", () => {
    expect(placeCameraOffset(rect(0, 0, 1000, 800), [rect(650, 16, 334, 500), rect(16, 640, 968, 144)])).toEqual([-183, -88]);
  });
  it("reserves mobile bottom sheet without shifting coordinates", () => {
    expect(placeCameraOffset(rect(0, 0, 390, 844), [rect(0, 400, 390, 444)])).toEqual([-0, -230]);
    expect(placeCameraOffset(rect(0, 0, 390, 844), [])).toEqual([-0, -0]);
  });
});
