import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import { itemCost, editItemCost, isRailItem } from "@raiquora/trip/item-cost";
import { formatMoney, currencyMinorUnits } from "@raiquora/trip/money";
import { parseCostInput } from "../../usecases/trip-plan/edit-trip-cost";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { element, control, option } from "./trip-workspace-elements";

export function itemCostCopy(trip: Trip, item: ItineraryItem): string {
  const cost = itemCost(trip, item);
  if (!cost) return "未入力";
  const unit = cost.source === "provider" && cost.basis === "reference-minimum" ? "〜 / 1室1泊" : "";
  return `${formatMoney(cost.amount)}${unit}`;
}

export function renderItemCost(trip: Trip, item: ItineraryItem, controller: TripWorkspaceController, report: (text: string) => void): HTMLElement | undefined {
  if (isRailItem(item)) return undefined;
  const root = element("div", "trip-item-cost"), value = itemCostCopy(trip, item);
  root.append(element("span", "trip-item-cost-label", "概算費用"));
  if (!controller.canConfirm() || controller.source()?.getRole?.() === "viewer") { root.append(element("span", "", value)); return root; }
  const session = controller.sessionId();
  const current = () => controller.current()?.id === trip.id && controller.current()?.revision === trip.revision && controller.sessionId() === session && controller.canConfirm() && controller.source()?.getRole?.() !== "viewer";
  const edit = control(value === "未入力" ? "金額を入力" : value, () => {
    if (root.querySelector(".trip-cost-editor")) return;
    const form = element("form", "trip-cost-editor"), label = element("label", "", "概算金額（予定全体） "), input = element("input"), currency = element("select");
    const cost = itemCost(trip, item);
    input.type = "text"; input.inputMode = "decimal"; input.maxLength = 24; input.required = true;
    input.setAttribute("aria-label", `${item.title}の概算金額`); currency.setAttribute("aria-label", "通貨");
    // A reference minimum is not the user's total; do not prefill it as one.
    input.value = cost?.source === "user" ? formatMoney(cost.amount).split(" ")[1]!.replaceAll(",", "") : "";
    for (const code of Object.keys(currencyMinorUnits)) currency.append(option(code, code));
    currency.value = cost?.amount.currency ?? "JPY";
    const amount = element("div", "trip-cost-input-group"); amount.append(input, currency); label.append(amount);
    const submit = element("button", "", "変更案を確認"); submit.type = "submit";
    form.append(label, submit, control("取消", () => { form.remove(); edit.focus(); }));
    if (cost?.source === "user") form.append(control("入力を削除", () => {
      if (!current()) { report("旅程が更新されました。最新の予定から入力し直してください。"); return; }
      controller.propose(`${item.title}の概算費用を削除`, [editItemCost(trip, item.id)]); form.remove();
    }));
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!current()) { report("旅程が更新されました。最新の予定から入力し直してください。"); return; }
      try {
        controller.propose(`${item.title}の概算費用`, [editItemCost(trip, item.id, parseCostInput(input.value, currency.value))]); form.remove();
      } catch (error) { report(error instanceof Error ? error.message : "金額を確認してください。"); }
    });
    root.append(form); input.focus();
  });
  edit.className = "trip-item-cost-value";
  edit.setAttribute("aria-label", `${item.title}の概算費用を編集`); root.append(edit);
  return root;
}
