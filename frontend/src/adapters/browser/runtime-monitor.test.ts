import { describe, expect, it } from "vitest";

import { formatHeapUsage } from "./runtime-monitor";

describe("formatHeapUsage", () => {
  it("formats supported and unsupported browser heap values", () => {
    expect(formatHeapUsage(undefined)).toBe("未対応");
    expect(formatHeapUsage(12 * 1_048_576)).toBe("12 MiB");
  });
});
