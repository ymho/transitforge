// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { configureConsultationScreen } from "./consultation-screen";
import { createTrip, type TripUpdateProposal } from "@raiquora/trip/trip";

beforeEach(() => { document.body.innerHTML = '<section class="ai-guide-panel"><header>旧見出し<div class="guide-panel-actions"></div></header><ol id="messages"></ol><form><input><button type="submit">送信</button></form></section>'; });
function setup(bound = true) {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "広島の旅", "2026-09-18T00:00:00Z", [], {
    goal: "街歩き", constraints: [{ id: "origin", source: "user", strength: "hard", scope: { type: "trip" }, requirement: { type: "origin", place: { name: "京都", sources: [] } } }], assumptions: [],
    party: { source: "user", adults: 2, children: [] },
  });
  const panel = document.querySelector<HTMLElement>("section")!, messages = document.querySelector("ol")!, form = document.querySelector("form")!, input = document.querySelector("input")!;
  let current = bound ? trip : undefined, sessionId = "session-a", changed = () => {};
  const save = vi.fn(async (_proposal: TripUpdateProposal) => {}), showTrip = vi.fn(), submit = vi.fn((e: Event) => e.preventDefault()); form.addEventListener("submit", submit);
  const screen = configureConsultationScreen(panel, messages, form, input, {
    read: () => ({ trip: current, sessionId }), profile: () => undefined, subscribe: (f) => { changed = f; return () => {}; },
    save, showTrip, newConversation: vi.fn(),
  });
  return { trip, panel, messages, form, input, save, showTrip, submit, screen, setTrip: (value: typeof trip) => { current = value; changed(); }, switch: () => { current = undefined; sessionId = "session-b"; changed(); } };
}
it("uses the explicit bound Trip and preserves message/composer nodes and listeners", () => {
  const f = setup(); expect(f.panel.classList.contains("ai-guide-panel")).toBe(false);
  expect(f.panel.textContent).not.toContain("旧見出し"); expect(f.panel.textContent).toContain("広島の旅");
  expect(f.panel.textContent).toContain("大人2人"); expect(f.panel.querySelector("ol")).toBe(f.messages);
  expect(f.panel.querySelector(".consultation-composer")).toBe(f.form); f.form.dispatchEvent(new Event("submit")); expect(f.submit).toHaveBeenCalledOnce();
  expect(f.panel.querySelector('.consultation-heading button[aria-label="新しい相談"]')!.getAttribute("aria-label")).toBe("新しい相談");
  expect(f.panel.querySelector('.consultation-heading button[aria-label="新しい相談"]')!.textContent).toBe("新しい相談");
  expect(f.panel.querySelector<HTMLButtonElement>('.consultation-composer button')!.getAttribute("aria-label")).toBe("送信");
  expect(f.panel.querySelector('.consultation-composer button')!.textContent).toBe("");
});
it("new consultation never infers a Trip from title or Home data", () => {
  const f = setup(false); expect(f.panel.textContent).toContain("新しい旅を相談中"); expect(f.panel.textContent).toContain("まだ旅程に紐付いていません");
  expect(f.panel.textContent).toContain("会話で追加できます"); expect(f.panel.querySelector(".consultation-add-condition")).toBeNull();
});
it("shows persisted partial people and budget without inventing missing details", () => {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "途中条件の旅", "2026-09-18T00:00:00Z", [], {
    constraints: [], assumptions: [], partialConditions: [
      { factId: "fact-party", sourceOperationId: "op-party", target: "party_size", scope: { type: "conversation" },
        modality: "preferred", precision: "exact", value: { kind: "quantity", amount: 3, unit: "people" }, frame: "actual",
        provenance: { kind: "user_turn", turnId: "33333333-3333-4333-8333-333333333333", quote: "3人です" } },
      { factId: "fact-budget", sourceOperationId: "op-budget", target: "budget", scope: { type: "conversation" },
        modality: "preferred", precision: "approximate", value: { kind: "money", amount: 500 }, frame: "actual",
        provenance: { kind: "user_turn", turnId: "33333333-3333-4333-8333-333333333333", quote: "500くらい" } },
    ],
  });
  const panel = document.querySelector<HTMLElement>("section")!, messages = document.querySelector("ol")!, form = document.querySelector("form")!, input = document.querySelector("input")!;
  configureConsultationScreen(panel, messages, form, input, { read: () => ({ trip, sessionId: "partial" }), profile: () => undefined,
    subscribe: () => () => {}, save: vi.fn(), showTrip: vi.fn(), newConversation: vi.fn() });
  expect(panel.textContent).toContain("3人（内訳未定）");
  expect(panel.textContent).toContain("500（通貨未定）（対象未定）");
  expect(panel.textContent).not.toContain("大人3人");
  expect(panel.textContent).not.toContain("JPY");
});

it("direct origin edit produces a revision-bound Proposal, never mutates Trip or copies provider identity", () => {
  const f = setup(); const before = JSON.stringify(f.trip);
  f.panel.querySelector<HTMLButtonElement>('[aria-label="出発地を編集"]')!.click();
  const editor = f.panel.querySelector<HTMLFormElement>(".consultation-condition-editor")!;
  editor.querySelector("input")!.value = "大阪"; editor.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(f.save).toHaveBeenCalledOnce(); const proposal = f.save.mock.calls[0]![0];
  expect(proposal.tripId).toBe(f.trip.id); expect(proposal.baseRevision).toBe(0);
  expect(proposal.patches[0]).toMatchObject({ type: "request", request: { constraints: [{ requirement: { place: { name: "大阪", sources: [] } } }] } });
  expect(JSON.stringify(f.trip)).toBe(before);
});
it("keeps condition content concise and groups secondary actions underneath", () => {
  const f = setup();
  expect(f.panel.textContent).not.toContain("あなたが指定");
  expect(f.panel.querySelector(".consultation-condition-source")).toBeNull();
  const edit = f.panel.querySelector('[aria-label="出発地を編集"]')!;
  const remove = f.panel.querySelector('[aria-label="出発地を削除"]')!;
  expect(edit.parentElement).toBe(remove.parentElement);
  expect(remove.parentElement?.className).toBe("consultation-condition-actions");
  expect(remove.textContent).toBe("削除");
  expect(f.panel.textContent).toContain("京都");
});
it("stale editor cannot submit into another session and mobile conditions close via Escape", () => {
  const f = setup(); f.panel.querySelector<HTMLButtonElement>('[aria-label="出発地を編集"]')!.click();
  const stale = f.panel.querySelector(".consultation-condition-editor")!; f.switch();
  stale.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.save).not.toHaveBeenCalled();
  const toggle = f.panel.querySelector<HTMLButtonElement>(".consultation-conditions-toggle")!; toggle.click(); expect(toggle.getAttribute("aria-expanded")).toBe("true");
  f.panel.querySelector("aside")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(toggle.getAttribute("aria-expanded")).toBe("false");
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
it("uses the existing Trip for inspiration and never exposes a second save-draft handoff", () => {
  const f = setup();
  expect([...f.panel.querySelectorAll("button")].map(button => button.textContent)).not.toContain("仮旅程を保存");
  expect(f.panel.textContent).not.toContain("条件はこの相談に保存");
  const back = f.panel.querySelector<HTMLButtonElement>(".consultation-trip-link")!;
  expect(back.disabled).toBe(false); expect(back.getAttribute("aria-label")).toBe("広島の旅の旅程に戻る"); back.click(); expect(f.showTrip).toHaveBeenCalledOnce();
});


it("shows an unknown end honestly and displays the explicit end when received", () => {
  const f = setup();
  const dates = { id: "dates", source: "user" as const, strength: "hard" as const, scope: { type: "trip" as const }, requirement: { type: "dates" as const, start: { earliest: "2026-10-24", latest: "2026-10-24" } } };
  f.setTrip({ ...f.trip, request: { ...f.trip.request, constraints: [...f.trip.request.constraints, dates] } });
  expect(f.panel.textContent).toContain("2026-10-24〜終了日未定");
  expect(f.panel.textContent).not.toContain("2026-10-24〜2026-10-24");
  f.setTrip({ ...f.trip, request: { ...f.trip.request, constraints: [f.trip.request.constraints[0]!, { ...dates, requirement: { ...dates.requirement, end: { earliest: "2026-10-25", latest: "2026-10-25" } } }] } });
  expect(f.panel.textContent).toContain("2026-10-24〜2026-10-25");
});

it("displays accepted composition and does not repeat an end already present in dates", () => {
  const f = setup();
  const provenance = { kind: "user_turn" as const, turnId: "33333333-3333-4333-8333-333333333333", quote: "大人2人、10月24日から25日" };
  const base = { scope: { type: "conversation" as const }, modality: "preferred" as const, precision: "exact" as const, frame: "actual" as const, provenance };
  f.setTrip({ ...f.trip, request: { constraints: [{ id: "dates", source: "user", strength: "hard", scope: { type: "trip" }, requirement: { type: "dates", start: { earliest: "2026-10-24", latest: "2026-10-24" }, end: { earliest: "2026-10-25", latest: "2026-10-25" } } }], assumptions: [], partialConditions: [
    { ...base, factId: "party", sourceOperationId: "party", target: "party_size", value: { kind: "party", adults: 2, children: [] } },
    { ...base, factId: "end", sourceOperationId: "end", target: "end_date", value: { kind: "local_date", date: "2026-10-25" } },
  ] } });
  expect(f.panel.textContent).toContain("大人2人");
  expect(f.panel.textContent).toContain("2026-10-24〜2026-10-25");
  expect(f.panel.textContent).not.toContain("開始日未定");
});
it("omits unset conditions and manual condition creation for a bound trip", () => {
  const f = setup();
  expect(f.panel.querySelector(".consultation-add-condition")).toBeNull();
  expect(f.panel.querySelector('[aria-label="追加する条件"]')).toBeNull();
  expect(f.panel.textContent).not.toContain("条件を追加");
  f.setTrip(createTrip(f.trip.id, "新しい旅", f.trip.createdAt));
  expect(f.panel.querySelectorAll(".consultation-condition-row")).toHaveLength(0);
  expect(f.panel.textContent).not.toContain("まだ決まっていません");
  expect(f.panel.textContent).not.toContain("人数は未設定");
  expect(f.panel.querySelector(".consultation-add-condition")).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
});

it("saves from the editor without navigation and blocks duplicate submissions while pending", async () => {
  const f = setup(); let finish!: () => void;
  f.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  f.panel.querySelector<HTMLButtonElement>('[aria-label="出発地を編集"]')!.click();
  const editor = f.panel.querySelector<HTMLFormElement>(".consultation-condition-editor")!;
  editor.querySelector("input")!.value = "大阪";
  expect(editor.querySelector('button[type="submit"]')!.textContent).toBe("保存");
  editor.dispatchEvent(new Event("submit", { cancelable: true }));
  editor.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(f.save).toHaveBeenCalledOnce(); expect(f.showTrip).not.toHaveBeenCalled();
  expect(editor.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  finish(); await vi.waitFor(() => expect(f.panel.querySelector(".consultation-condition-editor")).toBeNull());
  expect(f.panel.textContent).not.toContain("変更案を確認");
});
it("retains input and enables retry after a failed save", async () => {
  const f = setup(); f.save.mockRejectedValueOnce(new Error("通信に失敗しました"));
  f.panel.querySelector<HTMLButtonElement>('[aria-label="出発地を編集"]')!.click();
  const editor = f.panel.querySelector<HTMLFormElement>(".consultation-condition-editor")!;
  editor.querySelector("input")!.value = "大阪"; editor.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(f.panel.textContent).toContain("保存できませんでした"));
  expect(editor.querySelector("input")!.value).toBe("大阪");
  expect(editor.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(f.showTrip).not.toHaveBeenCalled();
});
