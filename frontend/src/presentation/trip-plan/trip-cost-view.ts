import type { Trip } from "@raiquora/trip/trip";
import { summarizeTripCosts, costCategories, costCategoryLabels } from "@raiquora/trip/trip-costs";
import { formatMoney, currencyMinorUnits } from "@raiquora/trip/money";
import { parseCostInput } from "../../usecases/trip-plan/edit-trip-cost";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { element, control, option } from "./trip-workspace-elements";
export function tripCostCopy(trip: Trip): string {
  if (!trip.costs) return "概算はまだありません";
  const view = summarizeTripCosts(trip.costs);
  return [trip.costs.stale ? "条件変更前の概算（再予測が必要）" : "AIによる概算",
    ...view.items.map(item => `${costCategoryLabels[item.category]}: ${item.displayedAmount ? formatMoney(item.displayedAmount) : "未推定"}${item.userEdited ? "（ユーザー編集）" : ""}`),
    `${view.partial ? "部分合計" : "合計"}（全員分）: ${view.totals.map(formatMoney).join(" / ") || "未推定"}`].join("\n");
}
export function renderTripCosts(trip: Trip, controller: TripWorkspaceController, ask: (text: string) => void, report: (text: string) => void) {
  const section = element("section", "trip-costs"); section.setAttribute("aria-label", "費用");
  section.append(element("h2", "", "費用"), element("p", "", "旅行全体・利用者全員分の概算です。予約価格・支払済み金額・価格保証ではありません。"));
  const current = () => controller.current()?.id === trip.id && controller.current()?.revision === trip.revision && controller.canConfirm();
  if (controller.canConfirm()) section.append(control(trip.costs ? "AIに再予測を依頼" : "AIに概算を依頼", () => {
    if (current()) ask("この旅程の交通・宿泊・観光・食事を、旅行全体・利用者全員分のAI概算として提案してください。不明な人数や泊数は前提を明記してください。");
  }));
  if (!trip.costs) { section.append(element("p", "", "概算はまだありません。")); return section; }
  if (trip.costs.stale) section.append(element("p", "trip-cost-warning", "旅程や条件が変わったため、概算が古くなっています。再予測してもユーザー編集は保持します。"));
  section.append(element("p", "", `生成日時: ${trip.costs.forecast.generatedAt}`));
  const view = summarizeTripCosts(trip.costs);
  for (const item of view.items) {
    const row = element("article", "trip-cost-item");
    row.append(element("h3", "", costCategoryLabels[item.category]), element("strong", "", item.displayedAmount ? formatMoney(item.displayedAmount) : "未推定"),
      element("p", "", item.userEdited ? "ユーザー編集" : "AIによる概算"), element("p", "", item.explanation));
    if (item.userEdited) row.append(element("p", "", `元のAI予測: ${item.amount ? formatMoney(item.amount) : "未推定"}`));
    if (item.assumptions.length) row.append(element("p", "", `前提: ${item.assumptions.join(" / ")}`));
    if (controller.canConfirm()) {
      row.append(control(`${costCategoryLabels[item.category]}の金額を編集`, () => {
        if (!current()) return;
        if (section.parentElement?.querySelector(".trip-cost-editor") || section.querySelector(".trip-cost-editor")) { report("編集中の費用を確認または取消してから、次の項目を編集してください。"); return; }
        const form = element("form", "trip-cost-editor"), label = element("label", "", "金額 "), input = element("input"), currency = element("select");
        input.type = "text"; input.inputMode = "decimal"; input.maxLength = 24; input.required = true;
        input.setAttribute("aria-label", `${costCategoryLabels[item.category]}の金額`); currency.setAttribute("aria-label", "通貨");
        for (const code of Object.keys(currencyMinorUnits)) currency.append(option(code, code));
        currency.value = item.displayedAmount?.currency ?? "JPY";
        input.value = item.displayedAmount ? formatMoney(item.displayedAmount).split(" ")[1]!.replaceAll(",", "") : "";
        label.append(input); form.append(label, currency);
        const preview = element("button", "", "変更案を確認"); preview.type = "submit";
        form.append(preview, control("取消", () => form.remove())); row.append(form); input.focus();
        form.addEventListener("submit", event => {
          event.preventDefault();
          if (!current()) { report("旅程が変わりました。最新の費用から編集し直してください。"); return; }
          try {
            const amount = parseCostInput(input.value, currency.value);
            controller.propose("費用のユーザー編集", [{ type: "cost_override", category: item.category, amount }]); form.remove();
          } catch (error) { report(error instanceof Error ? error.message : "金額を確認してください。"); }
        });
      }));
      if (item.userEdited) row.append(control(`${costCategoryLabels[item.category]}をAI予測へ戻す`, () => {
        if (current()) controller.propose("項目をAI予測へ戻す", [{ type: "cost_override", category: item.category }]);
      }));
    }
    section.append(row);
  }
  section.append(element("p", "trip-cost-total", `${view.partial ? "部分合計" : "合計"}（全員分）: ${view.totals.map(formatMoney).join(" / ") || "未推定"}`));
  if (view.partial) section.append(element("p", "", `${view.unknownCount}項目が未推定です。`));
  if (view.totals.length > 1) section.append(element("p", "", "通貨ごとに集計しています。為替換算はしていません。"));
  if (controller.canConfirm() && view.items.some(item => item.userEdited)) section.append(control("すべてAI予測へ戻す", () => {
    if (current() && section.ownerDocument.defaultView?.confirm("すべてのユーザー編集を解除する変更案を作りますか？")) controller.propose("すべてAI予測へ戻す", costCategories.map(category => ({ type: "cost_override", category })));
  }));
  return section;
}
