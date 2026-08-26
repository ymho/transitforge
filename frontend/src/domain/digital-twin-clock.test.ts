import { describe, expect, it, vi } from "vitest";

import type { DigitalTwinClockEnvironment } from "./digital-twin-clock";
import { createDigitalTwinClockSynchronizer } from "./digital-twin-clock";

describe("digital twin clock synchronizer", () => {
  it("synchronizes when enabled and whenever the browser becomes active", () => {
    let activate: () => void = () => undefined;
    let visible = true;
    let now = new Date("2026-08-15T01:00:00.000Z");
    const environment: DigitalTwinClockEnvironment = {
      now: () => now,
      isVisible: () => visible,
      subscribeToActivation: vi.fn((callback) => {
        activate = callback;
        return vi.fn();
      }),
    };
    const synchronize = vi.fn();
    const controller = createDigitalTwinClockSynchronizer(
      synchronize,
      environment,
    );

    controller.setEnabled(true);
    now = new Date("2026-08-15T01:03:00.000Z");
    activate();

    expect(synchronize).toHaveBeenNthCalledWith(
      1,
      new Date("2026-08-15T01:00:00.000Z"),
    );
    expect(synchronize).toHaveBeenNthCalledWith(
      2,
      new Date("2026-08-15T01:03:00.000Z"),
    );
  });

  it("does not synchronize while hidden or in simulation mode", () => {
    let activate: () => void = () => undefined;
    let visible = false;
    const unsubscribe = vi.fn();
    const environment: DigitalTwinClockEnvironment = {
      now: () => new Date("2026-08-15T01:00:00.000Z"),
      isVisible: () => visible,
      subscribeToActivation: (callback) => {
        activate = callback;
        return unsubscribe;
      },
    };
    const synchronize = vi.fn();
    const controller = createDigitalTwinClockSynchronizer(
      synchronize,
      environment,
    );

    controller.setEnabled(true);
    activate();
    visible = true;
    controller.setEnabled(false);
    activate();
    controller.dispose();

    expect(synchronize).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
