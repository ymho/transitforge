import { afterEach, describe, expect, it, vi } from "vitest";

import { createLoadingScreen } from "./loading-screen";

function elements() {
  const app = {
    dataset: { loadingState: "loading" },
    setAttribute: vi.fn(),
  } as unknown as HTMLElement;
  const screen = {
    classList: { add: vi.fn(), remove: vi.fn() },
    hidden: true,
    setAttribute: vi.fn(),
  } as unknown as HTMLElement;
  const message = { textContent: "starting" } as HTMLElement;
  const retry = { hidden: true } as HTMLButtonElement;
  const steps = (["map", "routes", "trains", "draw"] as const).map((loadingStep) => ({
    dataset: { loadingStep, state: "pending" },
  } as unknown as HTMLElement));
  return { app, screen, message, retry, steps };
}

afterEach(() => vi.useRealTimers());

describe("loading screen", () => {
  it("stays hidden during product startup and covers only explicit map loading", () => {
    vi.useFakeTimers();
    const view = elements();
    const loading = createLoadingScreen(view);

    expect(loading.isComplete()).toBe(true);
    loading.start("地図を読み込んでいます。");
    expect(view.screen.hidden).toBe(false);
    expect(view.app.dataset.loadingState).toBe("loading");
    expect(view.app.setAttribute).toHaveBeenCalledWith("aria-busy", "true");
    expect(view.steps.map((step) => step.dataset.state)).toEqual(["loading", "pending", "pending", "pending"]);
    loading.setStep("map", "complete");
    loading.setStep("routes", "loading");
    expect(view.steps.map((step) => step.dataset.state)).toEqual(["complete", "loading", "pending", "pending"]);
    loading.setMessage("列車を読み込んでいます。");
    expect(view.message.textContent).toBe("列車を読み込んでいます。");
    expect(view.app.dataset.loadingState).toBe("loading");

    loading.complete();
    expect(view.app.dataset.loadingState).toBe("ready");
    expect(view.app.setAttribute).toHaveBeenCalledWith("aria-busy", "false");
    expect(view.screen.hidden).toBe(false);

    vi.runAllTimers();
    expect(view.screen.hidden).toBe(true);
    expect(loading.isComplete()).toBe(true);
  });

  it("shows an actionable map loading error", () => {
    const view = elements();
    const loading = createLoadingScreen(view);

    loading.start("地図を読み込んでいます。");
    loading.fail("入力を読み込めませんでした。");

    expect(view.app.dataset.loadingState).toBe("error");
    expect(view.message.textContent).toBe("入力を読み込めませんでした。");
    expect(view.retry.hidden).toBe(false);
    expect(view.screen.setAttribute).toHaveBeenCalledWith("role", "alert");
    expect(view.steps[0]!.dataset.state).toBe("error");
    expect(loading.isComplete()).toBe(false);
  });
});
