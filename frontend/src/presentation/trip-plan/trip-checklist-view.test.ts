// @vitest-environment happy-dom
import { it, expect, vi } from "vitest";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { tripWorkspacePreviewSource } from "../../dev/trip-workspace-preview";
import { renderTripChecklist } from "./trip-checklist-view";
import { renderTripReadiness } from "./trip-readiness-view";

it("derived issues have no checkbox; preparation supports add/done/not-needed/links and confirmation preview", async () => {
  const source = tripWorkspacePreviewSource(), c = createTripWorkspaceController("one"); c.attach("one", source);
  const trip = c.current()!, before = JSON.stringify(trip), focus = vi.fn(), report = vi.fn();
  const render = () => renderTripChecklist({ controller: c.checklist, trip, readiness: c.readiness()!, newId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", focus, ask: vi.fn(), report });
  const derived = renderTripReadiness(c.readiness()!, trip, focus);
  expect(derived.textContent).toContain("次に決めること"); expect(derived.querySelector('input[type="checkbox"]')).toBeNull();
  let ui = render(); expect(ui.textContent).toContain("未完了 1");
  const check = ui.querySelector<HTMLInputElement>('input[type="checkbox"]')!; check.checked = true; check.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(c.checklist.items()![0]!.status).toBe("done"));
  ui = render(); [...ui.querySelectorAll("button")].find((b) => b.textContent === "不要にする")!.click();
  await vi.waitFor(() => expect(c.checklist.items()![0]!.status).toBe("not-needed"));
  ui = render(); const add = ui.querySelector<HTMLFormElement>('[aria-label="準備項目を追加"]')!;
  add.querySelector("input")!.value = "乗車券を確認"; add.querySelectorAll("select")[1]!.value = "air";
  add.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(c.checklist.items()).toHaveLength(2));
  ui = render(); [...ui.querySelectorAll("button")].find((b) => b.textContent === "関連する予定")!.click(); expect(focus).toHaveBeenCalledWith("air");
  c.checklist.preview({ tripId: trip.id, suggestions: [{ category: "packing", title: "傘" }] });
  ui = render(); expect(ui.textContent).toContain("まだ保存されていません"); expect(c.checklist.items()).toHaveLength(2);
  [...ui.querySelectorAll("button")].find((b) => b.textContent === "確認して準備リストへ追加")!.click();
  await vi.waitFor(() => expect(c.checklist.items()).toHaveLength(3)); expect(JSON.stringify(c.current())).toBe(before);
});
it("read-only host disables edits, preserves nonblocking unknown and does not claim hotel opening verified", () => {
  const source = tripWorkspacePreviewSource(); source.checklist = { getItems: source.checklist!.getItems };
  const c = createTripWorkspaceController("a"); c.attach("a", source);
  const trip = c.current()!;
  const ui = renderTripChecklist({ controller: c.checklist, trip, readiness: c.readiness()!, newId: vi.fn(), focus: vi.fn(), ask: vi.fn(), report: vi.fn() });
  expect(ui.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  expect(ui.textContent).toContain("編集は現在利用できません");
  expect(renderTripReadiness(c.readiness()!, trip, vi.fn()).textContent).toContain("利用可能と確認済みという意味ではありません");
});
