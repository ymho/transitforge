import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { tripProposalProjection } from "./trip-workspace-projection";
import { element, control } from "./trip-workspace-elements";
import { reservationChangeKey } from "@raiquora/trip/reservation";

export function renderWorkspaceProposal(trip: Trip, proposal: TripUpdateProposal, controller: TripWorkspaceController,
  report: (text: string) => void): HTMLElement {
  const view = tripProposalProjection(trip, proposal);
  const section = element("section", "trip-workspace-proposal");
  section.setAttribute("aria-label", "未確認の変更案");
  section.append(element("h2", "", "変更案（まだ反映していません）"), element("p", "", view.summary));
  const compare = (before: string, after: string) => {
    const row = element("div", "trip-workspace-diff");
    for (const [label, text] of [["現在", before], ["変更後", after]]) {
      const column = element("div"); column.append(element("h3", "", label), element("p", "trip-workspace-copy", text)); row.append(column);
    }
    section.append(row);
  };
  for (const change of view.changes) compare(change.before, change.after);
  if (view.requestChanged) compare(view.beforeConditions, view.afterConditions);
  if (view.beforeState !== view.afterState) compare(view.beforeState, view.afterState);
  const warnings = controller.reservationWarnings();
  const consent = element("input"); consent.type = "checkbox";
  const key = reservationChangeKey(proposal, controller.reservations() ?? []);
  if (warnings.length) {
    const label = element("label", "trip-workspace-assumption");
    label.append(consent, document.createTextNode("予約済みの予定を変更します。予約の変更・取消は別操作であり、この操作では行われないことを確認しました。"));
    section.append(label);
  } else if (controller.reservations() === undefined) section.append(element("p", "", "予約記録は未取得です。予約がないことを意味しません。保存時にサーバで再確認します。"));
  if (controller.canConfirm()) {
    const server = controller.source()?.confirmationPersistence === "server";
    const confirm = control(server ? "確認して旅程を保存" : "確認して、この画面内に反映", () => {
      confirm.disabled = true;
      void controller.confirm(warnings.length && consent.checked ? { reservationChangeKey: key } : undefined).then(() => report(server ? controller.loadState() === "loaded" ? "旅程を保存しました。" : "保存後の最新旅程を取得できません。再読み込みしてください。" : "この画面内に反映しました。永続保存はしていません。"))
        .catch((error: unknown) => { confirm.disabled = false; report(error instanceof Error ? error.message : "変更案を確認できませんでした"); });
    });
    confirm.disabled = warnings.length > 0;
    consent.addEventListener("change", () => { confirm.disabled = !consent.checked; });
    section.append(confirm);
  } else section.append(element("p", "", "確認用プレビューです。保存機能はまだ有効ではありません。"));
  section.append(control("変更案を閉じる", () => controller.dismiss()));
  return section;
}
