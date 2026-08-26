import { describe, expect, it } from "vitest";

import { currentBrowserCoordinate, type BrowserGeolocation } from "./current-coordinate";

describe("currentBrowserCoordinate", () => {
  it("returns the browser coordinate with low-cost location options", async () => {
    let options: PositionOptions | undefined;
    const geolocation: BrowserGeolocation = {
      getCurrentPosition(success, _error, value) {
        options = value;
        success({ coords: { longitude: 135.5, latitude: 34.7 } } as GeolocationPosition);
      },
    };
    await expect(currentBrowserCoordinate(geolocation)).resolves.toEqual([135.5, 34.7]);
    expect(options).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 5 * 60_000,
    });
  });

  it("asks for a station when geolocation is unavailable", async () => {
    await expect(currentBrowserCoordinate(undefined)).rejects.toThrow(
      "出発駅を入力してください",
    );
  });
});
