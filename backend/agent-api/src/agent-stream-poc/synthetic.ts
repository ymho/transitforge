import type { ObservedAgentRun } from "./handler.js";

/** Controlled PoC fixtures. Never accept arbitrary delays or provider input from the public body. */
export const streamScenarios = {
  immediate: { delayMs: 0, initialMs: 0 },
  over30: { delayMs: 35_000, initialMs: 0 },
  ninety: { delayMs: 90_000, initialMs: 0 },
  minutes: { delayMs: 180_000, initialMs: 0 },
  initial_silent: { delayMs: 1000, initialMs: 35_000 },
  initial_delay: { delayMs: 1000, initialMs: 35_000 },
  silent: { delayMs: 90_000, initialMs: 0 },
  mid_error: { delayMs: 1000, initialMs: 0 },
  missing_final: { delayMs: 1000, initialMs: 0 },
} as const;
export type StreamScenario = keyof typeof streamScenarios;
export function syntheticAgentRun(scenario: StreamScenario): ObservedAgentRun {
  const timing = streamScenarios[scenario];
  return async (_input, emit) => {
    if (timing.initialMs) await sleep(timing.initialMs);
    await emit({ type: "progress", phase: "running" });
    if (timing.delayMs) await sleep(timing.delayMs);
    if (scenario === "mid_error") throw new Error("PRIVATE synthetic provider failure");
    if (scenario !== "missing_final") await emit({ type: "final", status: "completed", response: "合成試験が完了しました。" });
  };
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
