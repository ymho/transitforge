import type { TripUpdateProposal } from "@raiquora/trip/trip";
import { bookedReservationChanges, reservationChangeKey } from "@raiquora/trip/reservation";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { confirmAction } from "../shared/app-dialog";

/** Manual edits commit at the editor's explicit submit, without publishing a preview panel. */
export async function saveTripEdit(form: HTMLElement, button: HTMLButtonElement, controller: TripWorkspaceController,
  proposal: TripUpdateProposal, report: (text: string) => void): Promise<boolean> {
  if (button.disabled) return false;
  button.disabled = true;
  const session = controller.sessionId();
  let status = form.querySelector<HTMLElement>(".trip-edit-save-status");
  if (!status) { status = form.ownerDocument.createElement("p"); status.className = "trip-edit-save-status"; status.setAttribute("role", "status"); form.append(status); }
  status.textContent = "保存中…";
  try {
    const facts = controller.reservations();
    const booked = !!facts && bookedReservationChanges(proposal, facts).length > 0;
    const replan = controller.replan(proposal);
    if ((booked || replan?.confirmationKey) && !await confirmAction(form.ownerDocument,
      "予約・固定予定への変更の影響を確認して保存しますか？予約自体の変更・取消は予約先で手続きしてください。")) { status.textContent = ""; return false; }
    if (controller.sessionId() !== session || controller.current()?.id !== proposal.tripId || controller.current()?.revision !== proposal.baseRevision) throw new Error("旅程が更新されました。最新の予定から編集し直してください。");
    await controller.applyConfirmed(proposal, { ...(booked ? { reservationChangeKey: reservationChangeKey(proposal, facts!) } : {}),
      ...(replan?.confirmationKey ? { replanConfirmationKey: replan.confirmationKey } : {}) });
    if (controller.sessionId() === session && controller.source()?.confirmationPersistence === "server" && controller.loadState() !== "loaded") throw new Error("保存後の旅程を取得できません。再読み込みして保存結果を確認してください。");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "変更を保存できませんでした。";
    status.textContent = message; report(message); return false;
  } finally { button.disabled = false; }
}
