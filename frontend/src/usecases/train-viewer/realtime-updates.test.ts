// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { configureTrainDelayUpdates, configureTrainCongestionUpdates, type RealtimeUpdateDependencies } from "./realtime-updates";
import type { PollingOptions } from "../polling-controller";
import type { TrainDelaySnapshot, TrainCongestionSnapshot } from "@raiquora/operation/operation";
const state = vi.hoisted(() => ({ options: undefined as unknown }));
vi.mock("../polling-controller", () => ({ createPollingController: (options: unknown) => {
  state.options = options; return { setEnabled: vi.fn(), dispose: vi.fn() };
} }));
const dependencies = { pollingEnvironment: vi.fn() } as unknown as RealtimeUpdateDependencies;
beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
it("invalidates previous delay observations on failure or partial snapshots and recovers", () => {
  const update = vi.fn(); configureTrainDelayUpdates(update, dependencies);
  const options = state.options as PollingOptions<TrainDelaySnapshot>;
  const snapshot = { collectedAt: new Date().toISOString(), failedSources: [], operationsByTrainNumber: new Map() };
  options.apply(snapshot); expect(update).toHaveBeenLastCalledWith(snapshot);
  options.onError(new Error("offline")); expect(update).toHaveBeenLastCalledWith(undefined);
  options.apply({ ...snapshot, failedSources: ["a"] }); expect(update).toHaveBeenLastCalledWith(undefined);
  options.apply(snapshot); expect(update).toHaveBeenLastCalledWith(snapshot);
});
it("clears previously displayed congestion on fetch failure", () => {
  const layer = { setCongestionByTrainNumber: vi.fn(), setCongestionVisible: vi.fn() };
  configureTrainCongestionUpdates(layer, document.createElement("button"), dependencies);
  const options = state.options as PollingOptions<TrainCongestionSnapshot>;
  options.onError(new Error("offline"));
  expect(layer.setCongestionByTrainNumber).toHaveBeenLastCalledWith(new Map());
});
