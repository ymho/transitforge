import { describe, expect, it } from "vitest";
import { evaluateIncrementally, type RevalidationPlan } from "./replan-dependencies";

describe("incremental re-evaluation", () => {
  it("matches full recomputation for deterministic generated inputs", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const ids = Array.from({ length: 12 }, (_, index) => `item-${index}`), changed = ids.filter((_, index) => (seed * (index + 3)) % 7 < 2);
      const plan: RevalidationPlan = { mode: "incremental", keepItemIds: ids.filter((id) => !changed.includes(id)), recomputeItemIds: changed, refetchItemIds: [], reconfirmItemIds: [], reasons: [] };
      const fingerprint = (id: string) => `${id}:${seed}`; const evaluate = (id: string) => id.length * seed;
      const previous = Object.fromEntries(ids.map((id) => [id, { fingerprint: fingerprint(id), value: evaluate(id) }]));
      const incremental = evaluateIncrementally(ids, plan, previous, fingerprint, evaluate);
      const full = Object.fromEntries(ids.map((id) => [id, evaluate(id)])); expect(incremental).toEqual(full);
    }
  });
  it("recomputes a kept slice when its fingerprint is stale", () => {
    const plan: RevalidationPlan = { mode: "incremental", keepItemIds: ["a"], recomputeItemIds: [], refetchItemIds: [], reconfirmItemIds: [], reasons: [] };
    expect(evaluateIncrementally(["a"], plan, { a: { fingerprint: "old", value: 1 } }, () => "new", () => 2)).toEqual({ a: 2 });
  });
});
