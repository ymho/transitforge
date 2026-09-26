import { describe, expect, it, vi } from "vitest";
import { applyOperationBasemapConfig, operationBasemapConfig } from "./operation-map-basemap";

describe("operation map basemap policy", () => {
  it("keeps large landmarks and their labels disabled", () => {
    expect(operationBasemapConfig.showLandmarkIcons).toBe(false);
    expect(operationBasemapConfig.showLandmarkIconLabels).toBe(false);
  });

  it("reapplies the same policy after a style reload", () => {
    const setConfigProperty = vi.fn();
    applyOperationBasemapConfig({ setConfigProperty });
    expect(setConfigProperty).toHaveBeenCalledWith("basemap", "showLandmarkIcons", false);
    expect(setConfigProperty).toHaveBeenCalledWith("basemap", "showLandmarkIconLabels", false);
    expect(setConfigProperty).toHaveBeenCalledWith("basemap", "showTransitLabels", false);
  });
});
