import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { proposeItineraryItem } from "../../usecases/trip-plan/itinerary-proposal";
import { itineraryItemCopy, itineraryScheduleLabel, itemAssumptions } from "./trip-workspace-projection";
import { element, control, option } from "./trip-workspace-elements";

export function renderWorkspaceCard(trip: Trip, item: ItineraryItem, controller: TripWorkspaceController,
  options: { collapsed: boolean; collapse(value: boolean): void; chat(prompt: string): void; report(message: string): void }): HTMLElement {
  const card = element("article", "trip-workspace-card"); card.dataset.itemId = item.id;
  const header = element("header");
  const focus = control(item.title, () => controller.focus(item.id));
  focus.className = "trip-workspace-item-focus";
  focus.setAttribute("aria-label", `${item.title}を相談対象にする`);
  const body = element("div", "trip-workspace-item-body");
  body.id = `trip-item-${encodeURIComponent(item.id)}`;
  body.hidden = options.collapsed;
  const expand = control(options.collapsed ? "開く" : "閉じる", () => {
    body.hidden = !body.hidden; expand.textContent = body.hidden ? "開く" : "閉じる";
    expand.setAttribute("aria-expanded", String(!body.hidden)); options.collapse(body.hidden);
  });
  expand.setAttribute("aria-expanded", String(!body.hidden)); expand.setAttribute("aria-controls", body.id);
  header.append(focus, expand); card.append(header, element("p", "", itineraryScheduleLabel(item.schedule, true)));
  for (const a of itemAssumptions(trip, item.id)) card.append(element("p", "trip-workspace-assumption", `⚠ ${a.field}の仮置き: ${a.text}`));
  body.append(element("p", "trip-workspace-copy", itineraryItemCopy(item)));
  const safe = (action: () => void) => { try { action(); } catch { options.report("この変更では条件・仮定との整合が取れません。会話で変更内容を相談してください。"); } };
  const actions = element("div", "trip-workspace-actions");
  actions.append(control("相談する", () => { controller.focus(item.id); options.chat("この予定を相談したい"); }),
    control("名称を変更", () => { editor.hidden = !editor.hidden; if (!editor.hidden) title.focus(); }),
    control("削除案", () => safe(() => controller.propose(`${item.title}を削除する案`, [{ type: "remove", itemId: item.id }]))));
  const moveLabel = element("label", "", "並べ替え ");
  const after = element("select", "trip-workspace-move-target"); after.append(option("先頭", ""));
  for (const other of trip.items) if (other.id !== item.id) after.append(option(`${other.title}の後`, other.id));
  const index = trip.items.findIndex((i) => i.id === item.id); after.value = trip.items[index - 1]?.id ?? "";
  moveLabel.append(after);
  actions.append(moveLabel, control("移動案", () => safe(() => controller.propose(`${item.title}の順序を変更する案`,
    [{ type: "move", itemId: item.id, ...(after.value ? { afterId: after.value } : {}) }]))));
  if (item.type === "stay") actions.append(control("宿候補を相談", () => { controller.focus(item.id); options.chat("この宿泊予定の候補を比較したい"); }));
  actions.append(control("＋ この後の予定を相談", () => { controller.focus(item.id); options.chat("この予定の後に追加する予定を相談したい"); }));
  const editor = element("form", "trip-workspace-editor"); editor.hidden = true;
  const label = element("label", "", "予定の名称 "); const title = element("input"); title.value = item.title; title.required = true; title.maxLength = 200;
  label.append(title); const submit = element("button", "", "変更案を確認"); submit.type = "submit";
  editor.append(label, submit);
  editor.addEventListener("submit", (event) => {
    event.preventDefault(); safe(() => controller.preview(proposeItineraryItem(controller.current()!, { ...item, title: title.value }, { itemId: item.id, operation: "replace" })));
  });
  body.append(actions, editor); card.append(body); return card;
}

/** Refresh sibling references without replacing the card, editor or keyboard focus. */
export function refreshMoveTargets(card: HTMLElement, trip: Trip, itemId: string): void {
  const select = card.querySelector<HTMLSelectElement>(".trip-workspace-move-target");
  if (!select) return;
  const options = [["", "先頭"], ...trip.items.filter((i) => i.id !== itemId).map((i) => [i.id, `${i.title}の後`])];
  const key = JSON.stringify(options);
  if (select.dataset.targets === key) return;
  const value = select.value;
  select.replaceChildren(...options.map(([id, label]) => option(label!, id!)));
  select.value = options.some(([id]) => id === value) ? value : "";
  select.dataset.targets = key;
}
