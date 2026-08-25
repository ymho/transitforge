import { describe, expect, it, vi } from "vitest";

import { AgentRuntimeRolloutRouter } from "./runtime-rollout";

describe("AgentRuntimeRolloutRouter", () => {
  it("routes only enabled features to the new runtime", async () => {
    const agent = vi.fn(async () => "agent");
    const legacy = vi.fn(async () => "legacy");
    const router = new AgentRuntimeRolloutRouter(
      ["journey_planning"],
      agent,
      legacy,
    );

    await expect(router.handle({ feature: "journey_planning" })).resolves.toBe("agent");
    await expect(router.handle({ feature: "travel_planning" })).resolves.toBe("legacy");
    expect(agent).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
