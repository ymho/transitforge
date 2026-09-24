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
  expect(f.panel.querySelector('.consultation-heading button')!.getAttribute("aria-label")).toBe("新しい相談");
  expect(f.panel.querySelector('.consultation-heading button')!.textContent).toBe("");
  expect(f.panel.querySelector<HTMLButtonElement>('.consultation-composer button')!.getAttribute("aria-label")).toBe("送信");
  expect(f.panel.querySelector('.consultation-composer button')!.textContent).toBe("");
});
it("new consultation never infers a Trip from title or Home data", () => {
  const f = setup(false); expect(f.panel.textContent).toContain("新しい旅を相談中"); expect(f.panel.textContent).toContain("まだ旅程に紐付いていません");
  expect(f.panel.textContent).toContain("会話で追加できます"); expect(f.panel.querySelector(".consultation-add-condition")).toBeNull();
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
it("shows each condition's source without treating it as a second editable state", () => {
  const f = setup(); expect(f.panel.textContent).toContain("あなたが指定"); expect(f.panel.textContent).toContain("今回の条件");
});
it("stale editor cannot submit into another session and mobile conditions close via Escape", () => {
  const f = setup(); f.panel.querySelector<HTMLButtonElement>('[aria-label="出発地を編集"]')!.click();
  const stale = f.panel.querySelector(".consultation-condition-editor")!; f.switch();
  stale.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.preview).not.toHaveBeenCalled();
  const toggle = f.panel.querySelector<HTMLButtonElement>(".consultation-conditions-toggle")!; toggle.click(); expect(toggle.getAttribute("aria-expanded")).toBe("true");
  f.panel.querySelector("aside")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
it("adds exact dates through the same preview without changing adopted schedules", () => {
  const f = setup();
  f.panel.querySelector<HTMLSelectElement>('[aria-label="追加する条件"]')!.value = "dates";
  f.panel.querySelector<HTMLButtonElement>(".consultation-add-condition button")!.click();
  const editor = f.panel.querySelector<HTMLFormElement>(".consultation-condition-editor")!;
  editor.querySelector<HTMLInputElement>('[name="start"]')!.value = "2026-10-01";
  editor.querySelector<HTMLInputElement>('[name="end"]')!.value = "2026-10-03";
  editor.dispatchEvent(new Event("submit", { cancelable: true }));
  const proposal = f.preview.mock.calls[0]![0];
  expect(proposal.patches).toHaveLength(1); expect(proposal.patches[0].type).toBe("request");
  expect(proposal.patches[0].request.constraints.at(-1)).toMatchObject({ source: "user", requirement: { type: "dates", start: { earliest: "2026-10-01", latest: "2026-10-01" } } });
});
it("mobile sheet traps focus and restores background scrolling and trigger focus", () => {
  const f = setup(); document.body.style.overflow = "auto";
  const toggle = f.panel.querySelector<HTMLButtonElement>(".consultation-conditions-toggle")!; toggle.click();
  expect(document.body.style.overflow).toBe("hidden");
  const close = f.panel.querySelector<HTMLButtonElement>(".consultation-conditions-close")!;
  expect(document.activeElement).toBe(close);
  close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).not.toBe(close);
  close.click(); expect(document.body.style.overflow).toBe("auto"); expect(document.activeElement).toBe(toggle);
});
it("pre-Trip conditions require review and save to Conversation without previewing an adopted Trip", async () => {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "相談", "2026-09-18T00:00:00Z");
  const preview = vi.fn(), saveDraftRequest = vi.fn(async () => {});
  const panel = document.querySelector<HTMLElement>("section")!;
  configureConsultationScreen(panel, document.querySelector("ol")!, document.querySelector("form")!, document.querySelector("input")!, {
    read: () => ({ sessionId: trip.id, trip, draft: true }), profile: () => undefined, subscribe: () => () => {},
    preview, saveDraftRequest, showTrip: vi.fn(), newConversation: vi.fn(), saveDraftTrip: vi.fn(),
  });
  panel.querySelector<HTMLButtonElement>('[aria-label="旅の目的を編集"]')!.click();
  const editor = panel.querySelector("form.consultation-condition-editor")!;
  editor.querySelector("input")!.value = "温泉"; editor.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(saveDraftRequest).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  expect(panel.querySelector(".consultation-draft-review")?.textContent).toContain("温泉");
  panel.querySelector<HTMLButtonElement>(".consultation-draft-review button")!.click();
  await vi.waitFor(() => expect(saveDraftRequest).toHaveBeenCalledWith({ ...trip.request, goal: "温泉" }, trip.request));
  expect(trip.request.goal).toBeUndefined();
});
it("reviews an AI draft proposal, saves only on confirmation and rejects stale, foreign and post-handoff proposals", async () => {
  let trip = createTrip("45300000-0000-4000-8000-000000000001", "相談", "2026-09-18T00:00:00Z"), draft = true;
  const baseRequest = trip.request, next = { ...baseRequest, goal: "美術館" };
  const proposal = { conversationId: trip.id, baseRequest, request: next, summary: "目的の変更案" };
  const preview = vi.fn(), saveDraftRequest = vi.fn(async (request) => { trip = { ...trip, request, revision: trip.revision + 1 }; });
  const panel = document.querySelector<HTMLElement>("section")!;
  const screen = configureConsultationScreen(panel, document.querySelector("ol")!, document.querySelector("form")!, document.querySelector("input")!, {
    read: () => ({ sessionId: trip.id, trip, draft }), profile: () => undefined, subscribe: () => () => {},
    preview, saveDraftRequest, showTrip: vi.fn(), newConversation: vi.fn(),
  });
  expect(() => screen.previewConsultationProposal({ ...proposal, conversationId: "22222222-2222-4222-8222-222222222222" })).toThrow();
  screen.previewConsultationProposal(proposal);
  expect(panel.querySelector(".consultation-draft-review")?.textContent).toContain("美術館");
  expect(saveDraftRequest).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  panel.querySelector<HTMLButtonElement>(".consultation-draft-review button")!.click();
  await vi.waitFor(() => expect(panel.textContent).toContain("相談の条件を保存しました"));
  expect(saveDraftRequest).toHaveBeenCalledWith(next, baseRequest);
  expect(() => screen.previewConsultationProposal(proposal)).toThrow();
  draft = false; expect(() => screen.previewConsultationProposal({ ...proposal, baseRequest: next })).toThrow();
});
