// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { configureConsultationScreen } from "./consultation-screen";
import { createTrip } from "@raiquora/trip/trip";

beforeEach(() => { document.body.innerHTML = '<section class="ai-guide-panel"><header>旧見出し<div class="guide-panel-actions"></div></header><ol id="messages"></ol><form><input><button type="submit">送信</button></form></section>'; });
function setup(bound = true) {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "広島の旅", "2026-09-18T00:00:00Z", [], {
    goal: "街歩き", constraints: [{ id: "origin", source: "user", strength: "hard", scope: { type: "trip" }, requirement: { type: "origin", place: { name: "京都", sources: [] } } }], assumptions: [],
    party: { source: "user", adults: 2, children: [] },
  });
  const panel = document.querySelector<HTMLElement>("section")!, messages = document.querySelector("ol")!, form = document.querySelector("form")!, input = document.querySelector("input")!;
  let current = bound ? trip : undefined, sessionId = "session-a", changed = () => {};
  const preview = vi.fn(), showTrip = vi.fn(), submit = vi.fn((e: Event) => e.preventDefault()); form.addEventListener("submit", submit);
  const screen = configureConsultationScreen(panel, messages, form, input, {
    read: () => ({ trip: current, sessionId }), profile: () => undefined, subscribe: (f) => { changed = f; return () => {}; },
    preview, showTrip, newConversation: vi.fn(),
  });
  return { trip, panel, messages, form, input, preview, showTrip, submit, screen, switch: () => { current = undefined; sessionId = "session-b"; changed(); } };
}
it("uses the explicit bound Trip and preserves message/composer nodes and listeners", () => {
  const f = setup(); expect(f.panel.classList.contains("ai-guide-panel")).toBe(false);
  expect(f.panel.textContent).not.toContain("旧見出し"); expect(f.panel.textContent).toContain("広島の旅について相談中");
  expect(f.panel.textContent).toContain("大人2人"); expect(f.panel.querySelector("ol")).toBe(f.messages);
  expect(f.panel.querySelector(".consultation-composer")).toBe(f.form); f.form.dispatchEvent(new Event("submit")); expect(f.submit).toHaveBeenCalledOnce();
});
it("new consultation never infers a Trip from title or Home data", () => {
  const f = setup(false); expect(f.panel.textContent).toContain("新しい旅を相談中"); expect(f.panel.textContent).toContain("まだ旅程に紐付いていません");
});
it("direct origin edit produces a revision-bound Proposal, never mutates Trip or copies provider identity", () => {
  const f = setup(); const before = JSON.stringify(f.trip);
  f.panel.querySelector<HTMLButtonElement>('[aria-label="出発地を編集"]')!.click();
  const editor = f.panel.querySelector<HTMLFormElement>(".consultation-condition-editor")!;
  editor.querySelector("input")!.value = "大阪"; editor.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(f.preview).toHaveBeenCalledOnce(); const proposal = f.preview.mock.calls[0]![0];
  expect(proposal.tripId).toBe(f.trip.id); expect(proposal.baseRevision).toBe(0);
  expect(proposal.patches[0].request.constraints[0].requirement.place).toEqual({ name: "大阪", sources: [] });
  expect(JSON.stringify(f.trip)).toBe(before);
});
it("stale editor cannot submit into another session and mobile conditions close via Escape", () => {
  const f = setup(); f.panel.querySelector<HTMLButtonElement>('[aria-label="出発地を編集"]')!.click();
  const stale = f.panel.querySelector(".consultation-condition-editor")!; f.switch();
  stale.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.preview).not.toHaveBeenCalled();
  const toggle = f.panel.querySelector<HTMLButtonElement>(".consultation-conditions-toggle")!; toggle.click(); expect(toggle.getAttribute("aria-expanded")).toBe("true");
  f.panel.querySelector("aside")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
