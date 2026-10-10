import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { proposeTripOrder, tripOrderDays, tripOrderDay } from "../../usecases/trip-plan/propose-trip-order";
import { element, control } from "./trip-workspace-elements";

export function openTripOrderEditor(controller: TripWorkspaceController, report: (text: string) => void): void {
  const trip = controller.current(); if (!trip || controller.source()?.getRole?.() === "viewer") return;
  const session = controller.sessionId(), order = trip.items.map(item => item.id), days = tripOrderDays(trip);
  const assignments = new Map(order.map(id => [id, tripOrderDay(trip, id)])), moved = new Set<string>();
  const dialog = element("dialog", "trip-editor-dialog trip-order-editor"); dialog.setAttribute("aria-label", "予定を並べ替え");
  const list = element("div", "trip-order-list"), status = element("p", "trip-order-status"); status.setAttribute("role", "status");
  let dragged: string | undefined;
  const preview = control("変更を確認", () => {
    const current = controller.current();
    if (!current || current.id !== trip.id || current.revision !== trip.revision || controller.sessionId() !== session || controller.source()?.getRole?.() === "viewer") {
      report("旅程が更新されました。並べ替えを開き直してください。"); dialog.close(); return;
    }
    try {
      const proposal = proposeTripOrder(current, order, [...moved].map(itemId => ({ itemId, dayKey: assignments.get(itemId)! })));
      if (proposal) controller.preview(proposal);
      dialog.close();
    } catch (error) { status.textContent = error instanceof Error ? error.message : "変更できません。予定を確認してください。"; }
  });
  const move = (id: string, to: number, dayKey: string) => {
    const item = trip.items.find(item => item.id === id)!;
    if (item.type === "transport") return;
    if (item.type === "stay" && item.selection.status === "selected" && dayKey !== tripOrderDay(trip, id)) {
      status.textContent = "宿泊日を変更するには宿を選び直してください。"; return;
    }
    const from = order.indexOf(id);
    order.splice(from, 1); order.splice(Math.max(0, Math.min(to, order.length)), 0, id);
    assignments.set(id, dayKey); moved.add(id); status.textContent = "動かした予定の時刻は未設定になります。あとで設定し直してください。"; render();
  };
  const render = () => {
    list.replaceChildren(); preview.disabled = order.every((id, index) => trip.items[index]!.id === id) && order.every(id => assignments.get(id) === tripOrderDay(trip, id));
    for (const day of days) {
      const section = element("section", "trip-order-day"), heading = element("h3", "", day.label), rows = element("ol", "");
      section.append(heading, rows);
      section.addEventListener("dragover", event => { if (dragged) event.preventDefault(); });
      section.addEventListener("drop", event => {
        event.preventDefault(); if (!dragged) return;
        const ids = order.filter(id => assignments.get(id) === day.key && id !== dragged);
        const last = ids.at(-1); move(dragged, last ? order.indexOf(last) + (order.indexOf(dragged) > order.indexOf(last) ? 1 : 0) : order.length - 1, day.key); dragged = undefined;
      });
      for (const id of order.filter(id => assignments.get(id) === day.key)) {
        const item = trip.items.find(item => item.id === id)!, index = order.indexOf(id), locked = item.type === "transport";
        const row = element("li", "trip-order-row"); row.draggable = !locked; row.dataset.itemId = id;
        row.append(element("span", "trip-order-handle", locked ? "" : "⠿"), element("span", "trip-order-title", item.title));
        if (locked) row.append(element("small", "trip-order-fixed", "移動のため固定"));
        else {
          const target = element("select", "trip-order-day-select"); target.setAttribute("aria-label", `${item.title}の移動先`);
          for (const optionDay of days) { const option = element("option", "", optionDay.label); option.value = optionDay.key; target.append(option); }
          target.value = day.key; target.disabled = item.type === "stay" && item.selection.status === "selected";
          target.title = target.disabled ? "宿泊日を変更するには宿を選び直してください" : "移動先の日";
          target.addEventListener("change", () => {
            const other = order.filter(other => other !== id && assignments.get(other) === target.value), last = other.at(-1);
            move(id, last ? order.indexOf(last) + (index > order.indexOf(last) ? 1 : 0) : order.length - 1, target.value);
          });
          const up = control("↑", () => move(id, index - 1, assignments.get(order[index - 1]!)!));
          const down = control("↓", () => move(id, index + 1, assignments.get(order[index + 1]!)!));
          up.setAttribute("aria-label", `${item.title}を上へ`); down.setAttribute("aria-label", `${item.title}を下へ`);
          up.disabled = index === 0; down.disabled = index === order.length - 1; row.append(target, up, down);
          row.addEventListener("dragstart", event => { dragged = id; event.dataTransfer?.setData("text/plain", id); });
        }
        row.addEventListener("dragover", event => { if (dragged) event.preventDefault(); });
        row.addEventListener("drop", event => { event.preventDefault(); event.stopPropagation(); if (dragged && dragged !== id) move(dragged, index, day.key); dragged = undefined; });
        row.addEventListener("dragend", () => { dragged = undefined; }); rows.append(row);
      }
      list.append(section);
    }
  };
  const footer = element("div", "trip-order-footer"); footer.append(control("取消", () => dialog.close()), preview);
  dialog.append(element("h2", "", "予定を並べ替え"), element("p", "trip-order-help", "動かした予定の時刻は未設定になります。あとで設定し直してください。移動予定は固定です。"), list, status, footer);
  dialog.addEventListener("close", () => dialog.remove()); (document.querySelector("#app") ?? document.body).append(dialog); render(); dialog.showModal();
}
