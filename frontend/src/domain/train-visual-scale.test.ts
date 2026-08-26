import { describe, expect, it } from "vitest";

import { trainVisualScaleForZoom } from "./train-visual-scale";

describe("train visual scale", () => {
  it("makes distant trains substantially smaller on screen", () => {
    const zoomedOutScreenSize = trainVisualScaleForZoom(5) * 2 ** 5;
    const referenceScreenSize = trainVisualScaleForZoom(15.5) * 2 ** 15.5;

    expect(zoomedOutScreenSize).toBeLessThan(referenceScreenSize * 0.4);
    expect(zoomedOutScreenSize).toBeGreaterThan(referenceScreenSize * 0.3);
  });

  it("approaches a small screen-size cap at wide-area zooms", () => {
    const screenSizeAtZoomFive = trainVisualScaleForZoom(5) * 2 ** 5;
    const screenSizeAtZoomTwo = trainVisualScaleForZoom(2) * 2 ** 2;

    expect(screenSizeAtZoomTwo).toBeLessThan(screenSizeAtZoomFive);
    expect(screenSizeAtZoomTwo).toBeGreaterThan(
      trainVisualScaleForZoom(15.5) * 2 ** 15.5 * 0.3,
    );
  });

  it("uses the building-safe minimum when zoomed in", () => {
    expect(trainVisualScaleForZoom(18)).toBe(1.5);
  });

  it("keeps extreme zoom values within safe scale limits", () => {
    expect(trainVisualScaleForZoom(-10)).toBe(250_000);
    expect(trainVisualScaleForZoom(30)).toBe(1.5);
  });

  it("does not shrink a train below the building-safe minimum", () => {
    expect(trainVisualScaleForZoom(20)).toBe(1.5);
    expect(trainVisualScaleForZoom(30)).toBe(1.5);
  });
});
