import { describe, expect, it } from "vitest";

import {
  availableExternalInformation,
  externalInformationFreshness,
  failedExternalInformation,
  type ExternalSourceEvidence,
} from "./external-travel-information";

const evidence: ExternalSourceEvidence = {
  id: "weather:provider:osaka:2026-08-27",
  kind: "weather",
  provider: "example-weather",
  retrievedAt: "2026-08-27T00:00:00Z",
  validFrom: "2026-08-27T00:00:00Z",
  validUntil: "2026-08-28T00:00:00Z",
  confidence: "provider-forecast",
};

describe("external travel information", () => {
  it("distinguishes fresh stale and unknown evidence", () => {
    expect(externalInformationFreshness([evidence], new Date("2026-08-27T12:00:00Z"))).toBe("fresh");
    expect(externalInformationFreshness([evidence], new Date("2026-08-29T00:00:00Z"))).toBe("stale");
    expect(externalInformationFreshness([{ ...evidence, validFrom: undefined, validUntil: undefined }])).toBe("unknown");
    expect(externalInformationFreshness([])).toBe("unknown");
  });

  it("does not turn provider failures into fabricated data", () => {
    expect(failedExternalInformation({
      code: "timeout",
      message: " provider timed out ",
      retryable: true,
    })).toEqual({
      status: "unavailable",
      freshness: "unknown",
      evidence: [],
      failure: { code: "timeout", message: "provider timed out", retryable: true },
    });
  });

  it("bounds evidence attached to one result", () => {
    const result = availableExternalInformation(
      { temperatureCelsius: 26 },
      Array.from({ length: 30 }, (_, index) => ({ ...evidence, id: `e-${index}` })),
      new Date("2026-08-27T12:00:00Z"),
    );
    expect(result.evidence).toHaveLength(24);
    expect(result.freshness).toBe("fresh");
  });
});
