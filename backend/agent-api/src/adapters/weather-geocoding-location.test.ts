import { describe, expect, it } from "vitest";
import { weatherGeocodingLocation } from "./weather-geocoding-location.js";

describe("weatherGeocodingLocation", () => {
  it.each([
    ["京都市中京区", "京都市"], ["横浜市西区", "横浜市"], ["神戸市中央区", "神戸市"],
    ["さいたま市大宮区", "さいたま市"], ["  大阪市北区  ", "大阪市"],
  ])("normalizes only city+ward notation: %s", (input, expected) => {
    expect(weatherGeocodingLocation(input)).toBe(expected);
  });
  it.each(["京都市", "四日市市", "市川市", "東京都新宿区", "新宿区", "美山町", "二条城", "京都市中京区二条通541"])(
    "does not guess a city from a POI, standalone ward or street address: %s", (input) => {
      expect(weatherGeocodingLocation(input)).toBe(input);
    },
  );
});
