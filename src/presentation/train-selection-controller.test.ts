import { describe, expect, it } from "vitest";

import { trainFocusPadding } from "./train-selection-controller";

describe("train focus padding", () => {
  it("keeps the focused train above the bottom sheet on mobile", () => {
    expect(trainFocusPadding(390, 844, 590)).toEqual({
      top: 0,
      right: 0,
      bottom: 590,
      left: 0,
    });
  });

  it("does not offset the map for the side sheet on desktop", () => {
    expect(trainFocusPadding(1280, 800, 540).bottom).toBe(0);
  });
});
