import { describe, expect, it } from "vitest";
import { accommodationProviderAttributionFromEnvironment } from "./accommodation-provider-attribution";

describe("accommodationProviderAttributionFromEnvironment", () => {
  it("returns the complete public attribution", () => {
    expect(accommodationProviderAttributionFromEnvironment({
      VITE_ACCOMMODATION_PROVIDER_DISPLAY_NAME: "Example Stay",
      VITE_ACCOMMODATION_PROVIDER_CREDIT_URL: "https://example.com/credit",
      VITE_ACCOMMODATION_PROVIDER_CREDIT_IMAGE_URL: "https://example.com/credit.gif",
      VITE_ACCOMMODATION_PROVIDER_CREDIT_ALT: "Example credit",
    })).toEqual({
      displayName: "Example Stay",
      creditUrl: "https://example.com/credit",
      creditImageUrl: "https://example.com/credit.gif",
      creditAlt: "Example credit",
    });
  });

  it("does not expose a partial attribution", () => {
    expect(accommodationProviderAttributionFromEnvironment({
      VITE_ACCOMMODATION_PROVIDER_DISPLAY_NAME: "Example Stay",
    })).toBeNull();
  });
});
