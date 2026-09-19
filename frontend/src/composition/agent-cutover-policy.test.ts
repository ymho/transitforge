import { describe, expect, it } from "vitest";

import { consultationTransport } from "./agent-cutover-policy";

describe("production consultation cutover policy", () => {
  it("uses Server Agent when enabled and stops consultation when production gate is off", () => {
    expect(consultationTransport(true)).toBe("server");
    expect(consultationTransport(false)).toBe("stopped");
  });
});
