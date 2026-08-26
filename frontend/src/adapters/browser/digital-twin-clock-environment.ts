import type { DigitalTwinClockEnvironment } from "../../domain/digital-twin-clock";

export function browserDigitalTwinClockEnvironment(): DigitalTwinClockEnvironment {
  return {
    now: () => new Date(),
    isVisible: () => document.visibilityState === "visible",
    subscribeToActivation(callback) {
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") callback();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("focus", callback);
      window.addEventListener("pageshow", callback);
      return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("focus", callback);
        window.removeEventListener("pageshow", callback);
      };
    },
  };
}
