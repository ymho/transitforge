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

  it("makes trains smaller on screen when zoomed in", () => {
    const referenceScreenSize = trainVisualScaleForZoom(15.5) * 2 ** 15.5;
    const zoomedInScreenSize = trainVisualScaleForZoom(18) * 2 ** 18;

    expect(zoomedInScreenSize).toBeLessThan(referenceScreenSize);
  });

  it("keeps extreme zoom values within safe scale limits", () => {
    expect(trainVisualScaleForZoom(-10)).toBe(250_000);
    expect(trainVisualScaleForZoom(30)).toBe(0.05);
  });
});
