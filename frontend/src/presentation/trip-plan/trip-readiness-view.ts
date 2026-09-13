import type { TripReadiness } from "@raiquora/trip/trip-readiness";
import type { Trip } from "@raiquora/trip/trip";
import { blocksReady } from "@raiquora/trip/trip-ready";
import { feasibilityIssueText } from "./trip-feasibility-view";
import { element, control } from "./trip-workspace-elements";
import { reservationStatusLabels } from "../../usecases/trip-plan/reservation-reader";

/** Derived issues deliberately have no checkboxes or manual complete action. */
export function renderTripReadiness(readiness: TripReadiness, trip: Trip, focus: (id: string) => void): HTMLElement {
  const section = element("section", "trip-workspace-readiness"); section.setAttribute("aria-label", "次に決めること");
  section.append(element("h2", "", "次に決めること"), element("p", "", `計画状態: ${trip.planningState}。準備リストの完了とは別です。`));
  for (const [title, issues] of [["旅程・条件", readiness.planning], ["予約", readiness.booking]] as const) {
    section.append(element("h3", "", title));
    const list = element("ul");
    for (const issue of issues) {
      const li = element("li", "", `${blocksReady(issue) ? "要確認" : "参考・未確認"}: ${feasibilityIssueText(issue)}`);
      for (const id of issue.itemIds) {
        const item = trip.items.find((i) => i.id === id);
        if (item) li.append(control(item.title, () => focus(id)));
      }
      list.append(li);
    }
    if (!issues.length) list.append(element("li", "", "今回の評価で該当する問題はありません"));
    section.append(list);
  }
  if (readiness.reservations.readState === "unavailable") section.append(element("p", "", "予約記録は取得できていません。予約済み・未予約の判断はできません。"));
  for (const record of readiness.reservations.records) {
    const name = trip.items.find((i) => i.id === record.itineraryItemId)?.title ?? "旅行に関連する予約";
    section.append(element("p", "", `${name}: ${reservationStatusLabels[record.status]}`));
  }
  for (const id of readiness.reservations.unrecordedItemIds) section.append(element("p", "", `${trip.items.find((i) => i.id === id)?.title ?? id}: 予約記録なし（予約状況・必要性は未確認）`));
  return section;
}
