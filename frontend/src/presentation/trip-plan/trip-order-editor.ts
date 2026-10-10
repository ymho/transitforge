import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { proposeTripOrder } from "../../usecases/trip-plan/propose-trip-order";
import { itineraryDay } from "./trip-workspace-projection";
import { element, control } from "./trip-workspace-elements";

export function openTripOrderEditor(controller: TripWorkspaceController, report: (text: string) => void): void {
  const trip = controller.current(); if (!trip || controller.source()?.getRole?.() === "viewer") return;
  const session = controller.sessionId(), order = trip.items.map(item => item.id);
  const dialog = element("dialog", "trip-editor-dialog trip-order-editor"); dialog.setAttribute("aria-label", "予定を並べ替え");
  const list = element("ol", "trip-order-list"); let dragged: string | undefined;
  const preview = control("変更を確認", () => {
    const current = controller.current();
    if (!current || current.id !== trip.id || current.revision !== trip.revision || controller.sessionId() !== session || controller.source()?.getRole?.() === "viewer") {
      report("旅程が更新されました。並べ替えを開き直してください。"); dialog.close(); return;
    }
    try {
      const proposal = proposeTripOrder(current, order);
      if (proposal) controller.preview(proposal);
      dialog.close();
    } catch { report("この順番では予定の条件が合いません。日時や移動を確認してください。"); }
  });
  const move = (from: number, to: number) => { const [id] = order.splice(from, 1); order.splice(to, 0, id!); render(); };
  const render = () => {
    list.replaceChildren(); preview.disabled = order.every((id, index) => trip.items[index]!.id === id);
    order.forEach((id, index) => {
      const item = trip.items.find(item => item.id === id)!;
      const row = element("li", "trip-order-row"); row.draggable = true; row.dataset.itemId = id;
      row.append(element("span", "trip-order-handle", "⠿"), element("span", "trip-order-title", item.title), element("small", "", itineraryDay(item)));
      const up = control("↑", () => { move(index, index - 1); list.children[index - 1]?.querySelector<HTMLButtonElement>("button")?.focus(); });
      const down = control("↓", () => { move(index, index + 1); list.children[index + 1]?.querySelector<HTMLButtonElement>("button")?.focus(); });
      up.setAttribute("aria-label", `${item.title}を上へ`); down.setAttribute("aria-label", `${item.title}を下へ`);
      up.disabled = index === 0; down.disabled = index === order.length - 1; row.append(up, down);
      row.addEventListener("dragstart", event => { dragged = id; event.dataTransfer?.setData("text/plain", id); });
      row.addEventListener("dragover", event => { if (dragged) event.preventDefault(); });
      row.addEventListener("drop", event => { event.preventDefault(); if (dragged && dragged !== id) move(order.indexOf(dragged), order.indexOf(id)); dragged = undefined; });
      row.addEventListener("dragend", () => { dragged = undefined; }); list.append(row);
    });
  };
  dialog.append(element("h2", "", "予定を並べ替え"), element("p", "", "ドラッグ、または上下ボタンで移動できます。日付・時刻は変わりません。"), list, preview, control("取消", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove()); document.body.append(dialog); render(); dialog.showModal();
}
