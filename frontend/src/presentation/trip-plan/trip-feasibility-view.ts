import type { TripFeasibilityCode } from "@raiquora/trip/trip-feasibility-contract";
import type { TripFeasibilityEvaluation, TripFeasibilityIssue } from "@raiquora/trip/trip-feasibility";
import { element } from "./trip-workspace-elements";

const labels: Record<TripFeasibilityCode, string> = {
  empty_trip: "採用済みの予定がありません", schedule_unknown: "日時・所要時間が未確定です",
  schedule_overlap: "予定の時間と順序が両立しません", schedule_window_possible: "時間帯の中で両立する配置を決める必要があります",
  movement_unknown: "予定間の移動を確認できていません", movement_insufficient: "移動に必要な時間が足りません",
  transport_unresolved: "移動手段・経路が未選択です", transport_unverified: "採用した移動の所要時間が未検証です",
  stay_unselected: "宿泊先が未選択です", visit_unknown: "訪問日時の営業・利用条件を確認できていません",
  visit_unavailable: "確認した利用条件では訪問できません", external_facts_invalid: "取得済み情報が古い計画または不正な形式のため使えません",
  hard_constraint_violated: "必須条件を満たしていません", hard_constraint_unknown: "必須条件の充足を確認できていません",
  assumption_unconfirmed: "仮置きの条件が未確認です", reservations_unknown: "予約記録を取得できていません",
  reservation_unknown: "予約状態が未確認です", reservation_time_unknown: "予約日時と予定を比較する情報が不足しています",
  reservation_conflict: "予約の固定日時と予定が一致しません", reservation_dangling: "予約に対応する予定が旅程にありません",
  reservation_required: "予約が必要ですが、予約済みの記録を確認できていません",
  stay_time_precision: "宿泊日程は確定していますが、チェックイン・アウトの正確な時刻は未確認です",
  stay_visit_unchecked: "採用済みの宿泊先の営業・利用条件は未取得です。利用可能と確認済みという意味ではありません",
  stay_movement_time_precision: "宿泊前後の移動は日付順を確認していますが、正確な時刻の余裕は未確認です",
  stay_reservation_time_precision: "宿泊予約の正確な利用時刻と旅程の照合は未確認です",
  window_time_precision: "所要時間と時間帯はありますが、正確な開始時刻は未確定です",
};
export function feasibilityIssueText(issue: TripFeasibilityIssue): string { return labels[issue.code]; }
export function renderTripFeasibility(evaluation: TripFeasibilityEvaluation): HTMLElement {
  const section = element("section", "trip-workspace-feasibility");
  section.dataset.feasibility = evaluation.status;
  section.setAttribute("aria-label", "旅程の成立性");
  const label = { feasible: "成立", infeasible: "不成立", unknown: "未確認" }[evaluation.status];
  section.append(element("h2", "", `成立性: ${label}`), element("p", "", `旅程 revision ${evaluation.tripRevision} の計画と取得済み情報による評価です。予約済み・実際の運行を保証するものではありません。`));
  const evaluated = element("time", "", `評価時点: ${evaluation.evaluatedAt}`); evaluated.dateTime = evaluation.evaluatedAt; section.append(evaluated);
  const list = element("ul");
  for (const issue of evaluation.issues) list.append(element("li", "", feasibilityIssueText(issue)));
  if (evaluation.issues.length) section.append(list);
  return section;
}
