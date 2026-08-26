import type { PollingEnvironment } from "../../application/polling-controller";

export function browserPollingEnvironment(): PollingEnvironment {
  return {
    now: () => Date.now(),
    isVisible: () => document.visibilityState === "visible",
    setTimer: (callback, delayMilliseconds) =>
      window.setTimeout(callback, delayMilliseconds),
    clearTimer: (timer) => window.clearTimeout(timer as number),
    subscribeToVisibilityChange: (callback) => {
      document.addEventListener("visibilitychange", callback);
      return () => document.removeEventListener("visibilitychange", callback);
    },
  };
}
