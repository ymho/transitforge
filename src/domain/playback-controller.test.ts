import { describe, expect, it, vi } from "vitest";

import type { AnimationScheduler } from "./playback-controller";
import { PlaybackController } from "./playback-controller";

describe("PlaybackController", () => {
  it("keeps playing after seeking and advances from the new time", () => {
    let scheduled: ((timestamp: number) => void) | undefined;
    const scheduler: AnimationScheduler = {
      request: vi.fn((callback) => {
        scheduled = callback;
        return 1;
      }),
      cancel: vi.fn(),
    };
    const render = vi.fn();
    const controller = new PlaybackController({
      initialRouteTime: 600,
      range: { minimum: 0, maximum: 1_800 },
      getMinutesPerSecond: () => 1,
      render,
      onOperatingDayWrapped: vi.fn(),
      scheduler,
    });

    controller.start();
    scheduled?.(1_000);
    controller.seek(1_388);
    scheduled?.(2_000);

    expect(controller.isPlaying()).toBe(true);
    expect(render).toHaveBeenNthCalledWith(1, 1_388);
    expect(render).toHaveBeenNthCalledWith(2, 1_389);
  });

  it("stops scheduling updates when explicitly paused", () => {
    const scheduler: AnimationScheduler = {
      request: vi.fn(() => 7),
      cancel: vi.fn(),
    };
    const controller = new PlaybackController({
      initialRouteTime: 600,
      range: { minimum: 0, maximum: 1_800 },
      getMinutesPerSecond: () => 1,
      render: vi.fn(),
      onOperatingDayWrapped: vi.fn(),
      scheduler,
    });

    controller.start();
    controller.stop();

    expect(controller.isPlaying()).toBe(false);
    expect(scheduler.cancel).toHaveBeenCalledWith(7);
  });

  it("does not add the inactive duration again after clock synchronization", () => {
    let scheduled: ((timestamp: number) => void) | undefined;
    const scheduler: AnimationScheduler = {
      request: vi.fn((callback) => {
        scheduled = callback;
        return 1;
      }),
      cancel: vi.fn(),
    };
    const render = vi.fn();
    const controller = new PlaybackController({
      initialRouteTime: 600,
      range: { minimum: 0, maximum: 1_800 },
      getMinutesPerSecond: () => 1,
      render,
      onOperatingDayWrapped: vi.fn(),
      scheduler,
    });

    controller.start();
    scheduled?.(1_000);
    controller.synchronize(700);
    scheduled?.(61_000);
    scheduled?.(62_000);

    expect(render).toHaveBeenNthCalledWith(1, 700);
    expect(render).toHaveBeenNthCalledWith(2, 701);
  });
});
