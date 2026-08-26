import { describe, expect, it, vi } from "vitest";

import {
  createPollingController,
  type PollingEnvironment,
} from "../../usecases/polling-controller";

class FakePollingEnvironment implements PollingEnvironment {
  currentTime = 0;
  visible = true;
  private nextTimer = 1;
  private timers = new Map<number, { callback: () => void; delay: number }>();
  private visibilityListeners = new Set<() => void>();

  now(): number {
    return this.currentTime;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setTimer(callback: () => void, delayMilliseconds: number): unknown {
    const timer = this.nextTimer++;
    this.timers.set(timer, { callback, delay: delayMilliseconds });
    return timer;
  }

  clearTimer(timer: unknown): void {
    this.timers.delete(timer as number);
  }

  subscribeToVisibilityChange(callback: () => void): () => void {
    this.visibilityListeners.add(callback);
    return () => this.visibilityListeners.delete(callback);
  }

  scheduledDelays(): number[] {
    return [...this.timers.values()].map(({ delay }) => delay);
  }

  runNextTimer(): void {
    const next = this.timers.entries().next().value as
      | [number, { callback: () => void; delay: number }]
      | undefined;
    if (!next) {
      throw new Error("scheduled timer is missing");
    }
    const [timer, scheduled] = next;
    this.timers.delete(timer);
    this.currentTime += scheduled.delay;
    scheduled.callback();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const listener of this.visibilityListeners) {
      listener();
    }
  }

  visibilityListenerCount(): number {
    return this.visibilityListeners.size;
  }
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("polling controller", () => {
  it("loads immediately and schedules the normal refresh interval", async () => {
    const environment = new FakePollingEnvironment();
    const apply = vi.fn();
    const controller = createPollingController(
      {
        load: async () => "snapshot",
        apply,
        onError: vi.fn(),
        refreshIntervalMilliseconds: 60_000,
        retryIntervalMilliseconds: 900_000,
      },
      environment,
    );

    await flushPromises();

    expect(apply).toHaveBeenCalledWith("snapshot");
    expect(environment.scheduledDelays()).toEqual([60_000]);
    controller.dispose();
  });

  it("uses the retry interval after a failed load", async () => {
    const environment = new FakePollingEnvironment();
    const error = new Error("unavailable");
    const onError = vi.fn();
    const controller = createPollingController(
      {
        load: async () => Promise.reject(error),
        apply: vi.fn(),
        onError,
        refreshIntervalMilliseconds: 60_000,
        retryIntervalMilliseconds: 900_000,
      },
      environment,
    );

    await flushPromises();

    expect(onError).toHaveBeenCalledWith(error);
    expect(environment.scheduledDelays()).toEqual([900_000]);
    controller.dispose();
  });

  it("pauses while hidden and resumes using the remaining interval", async () => {
    const environment = new FakePollingEnvironment();
    const load = vi.fn(async () => "snapshot");
    const controller = createPollingController(
      {
        load,
        apply: vi.fn(),
        onError: vi.fn(),
        refreshIntervalMilliseconds: 60_000,
        retryIntervalMilliseconds: 900_000,
      },
      environment,
    );
    await flushPromises();

    environment.currentTime = 10_000;
    environment.setVisible(false);
    expect(environment.scheduledDelays()).toEqual([]);

    environment.currentTime = 40_000;
    environment.setVisible(true);
    expect(environment.scheduledDelays()).toEqual([20_000]);

    environment.runNextTimer();
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("waits for visibility before the first load", async () => {
    const environment = new FakePollingEnvironment();
    environment.visible = false;
    const load = vi.fn(async () => "snapshot");
    const controller = createPollingController(
      {
        load,
        apply: vi.fn(),
        onError: vi.fn(),
        refreshIntervalMilliseconds: 60_000,
        retryIntervalMilliseconds: 900_000,
      },
      environment,
    );
    await flushPromises();
    expect(load).not.toHaveBeenCalled();

    environment.setVisible(true);
    environment.runNextTimer();
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("does not start overlapping loads", async () => {
    const environment = new FakePollingEnvironment();
    let resolveLoad: ((value: string) => void) | undefined;
    const load = vi.fn(
      () => new Promise<string>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const controller = createPollingController(
      {
        load,
        apply: vi.fn(),
        onError: vi.fn(),
        refreshIntervalMilliseconds: 60_000,
        retryIntervalMilliseconds: 900_000,
      },
      environment,
    );

    await controller.refreshNow();
    expect(load).toHaveBeenCalledTimes(1);
    resolveLoad?.("snapshot");
    await flushPromises();
    controller.dispose();
  });

  it("disables polling and releases resources when disposed", async () => {
    const environment = new FakePollingEnvironment();
    const apply = vi.fn();
    const controller = createPollingController(
      {
        load: async () => "snapshot",
        apply,
        onError: vi.fn(),
        refreshIntervalMilliseconds: 60_000,
        retryIntervalMilliseconds: 900_000,
      },
      environment,
    );
    await flushPromises();

    controller.setEnabled(false);
    expect(environment.scheduledDelays()).toEqual([]);
    controller.setEnabled(true);
    expect(environment.scheduledDelays()).toEqual([60_000]);

    controller.dispose();
    expect(environment.scheduledDelays()).toEqual([]);
    expect(environment.visibilityListenerCount()).toBe(0);
  });

  it("ignores an in-flight result after disposal", async () => {
    const environment = new FakePollingEnvironment();
    let resolveLoad: ((value: string) => void) | undefined;
    const apply = vi.fn();
    const controller = createPollingController(
      {
        load: () => new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
        apply,
        onError: vi.fn(),
        refreshIntervalMilliseconds: 60_000,
        retryIntervalMilliseconds: 900_000,
      },
      environment,
    );

    controller.dispose();
    resolveLoad?.("snapshot");
    await flushPromises();

    expect(apply).not.toHaveBeenCalled();
    expect(environment.scheduledDelays()).toEqual([]);
  });
});
