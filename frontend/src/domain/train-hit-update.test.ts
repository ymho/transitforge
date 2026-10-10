import { describe, expect, it } from "vitest";
import { nearestTrainHit, TrainHitUpdateSchedule } from "./train-hit-update";
describe("train hit updates", () => {
  it("keeps 30fps animation samples but publishes hit data at no more than 10Hz", () => {
    const schedule = new TrainHitUpdateSchedule();
    const updates = Array.from({ length: 30 }, (_, index) => schedule.shouldUpdate(index * 1000 / 30));
    expect(updates.filter(Boolean).length).toBeLessThanOrEqual(10);
    expect(updates[0]).toBe(true);
    expect(schedule.shouldUpdate(2000)).toBe(true);
  });
  it("uses latest screen positions and the existing 22px radius, including the edge", () => {
    const targets = [{ serviceUid: "a", point: { x: 10, y: 10 } }, { serviceUid: "b", point: { x: 20, y: 20 } }];
    expect(nearestTrainHit(targets, { x: 20, y: 20 })).toBe("b");
    expect(nearestTrainHit([targets[0]], { x: 32, y: 10 })).toBe("a");
    expect(nearestTrainHit([targets[0]], { x: 33, y: 10 })).toBeUndefined();
    expect(nearestTrainHit([], { x: 20, y: 20 })).toBeUndefined();
  });
});
