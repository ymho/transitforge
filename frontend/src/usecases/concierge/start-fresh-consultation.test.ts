import { expect, it, vi } from "vitest";
import { startFreshConsultation } from "./start-fresh-consultation";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function setup() {
  let current = true, active = "old";
  const ports = {
    create: vi.fn(async () => ({ id: "new" })),
    activate: vi.fn(async (id: string) => { active = id; }),
    isCurrent: () => current, currentConversationId: () => active, submit: vi.fn(),
  };
  return { ports, cancel: () => { current = false; }, switchTarget: () => { active = "other-trip"; } };
}
it("submits the original prompt once to the newly activated server conversation", async () => {
  const f = setup(), prompt = "出雲大社に行きたい。まだ日程は未定です。";
  await startFreshConsultation(prompt, f.ports);
  expect(f.ports.create).toHaveBeenCalledOnce(); expect(f.ports.activate).toHaveBeenCalledExactlyOnceWith("new");
  expect(f.ports.submit).toHaveBeenCalledExactlyOnceWith(prompt);
});
it("does not create anything after the navigation is already obsolete", async () => {
  const f = setup(); f.cancel();
  await expect(startFreshConsultation("旅", f.ports)).rejects.toThrow("navigation changed");
  expect(f.ports.create).not.toHaveBeenCalled(); expect(f.ports.submit).not.toHaveBeenCalled();
});
it("does not activate or submit a creation that returns after navigation/account change", async () => {
  const f = setup(), gate = deferred();
  f.ports.create.mockImplementationOnce(async () => { await gate.promise; return { id: "new" }; });
  const pending = startFreshConsultation("旅", f.ports); f.cancel(); gate.resolve();
  await expect(pending).rejects.toThrow("navigation changed");
  expect(f.ports.activate).not.toHaveBeenCalled(); expect(f.ports.submit).not.toHaveBeenCalled();
});
it("does not send after an awaited history activation finishes on an obsolete navigation", async () => {
  const f = setup(), gate = deferred();
  f.ports.activate.mockImplementationOnce(async () => { await gate.promise; });
  const pending = startFreshConsultation("旅", f.ports);
  await vi.waitFor(() => expect(f.ports.activate).toHaveBeenCalledOnce());
  f.cancel(); gate.resolve(); await expect(pending).rejects.toThrow("navigation changed");
  expect(f.ports.submit).not.toHaveBeenCalled();
});
it("never sends into a different conversation even if a caller's navigation check misses the switch", async () => {
  const f = setup(); f.ports.activate.mockImplementationOnce(async () => { f.switchTarget(); });
  await expect(startFreshConsultation("旅", f.ports)).rejects.toThrow("target changed");
  expect(f.ports.submit).not.toHaveBeenCalled();
});
it("propagates create/history failures without automatic retries or a model call", async () => {
  const f = setup(); f.ports.activate.mockRejectedValueOnce(new Error("history unavailable"));
  await expect(startFreshConsultation("旅", f.ports)).rejects.toThrow("history unavailable");
  expect(f.ports.create).toHaveBeenCalledOnce(); expect(f.ports.submit).not.toHaveBeenCalled();
});
