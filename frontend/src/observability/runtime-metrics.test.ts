import { describe, expect, it } from "vitest";

import { RuntimeMetrics } from "./runtime-metrics";

describe("runtime metrics", () => {
  it("summarises loading, update, and frame measurements", () => {
    const metrics = new RuntimeMetrics();
    metrics.recordRouteLoad(120);
    metrics.recordTrainLoad(340);
    metrics.recordPositionUpdate(8, 824);
    metrics.recordFrame(10);
    metrics.recordFrame(20);

    expect(metrics.getSnapshot()).toMatchObject({
      routeLoadMilliseconds: 120,
      trainLoadMilliseconds: 340,
      positionUpdateMilliseconds: 8,
      activeTrainCount: 824,
      averageFrameMilliseconds: 15,
      framesPerSecond: 1_000 / 15,
    });
  });
});
