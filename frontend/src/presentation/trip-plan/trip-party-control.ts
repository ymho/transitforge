import { saveTripEdit } from "./save-trip-edit";
import { openTripEditor } from "./trip-editor-dialog";
import type { Trip } from "@raiquora/trip/trip";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { proposeUserParty } from "../../usecases/trip-plan/update-trip-request";
import { partyWithCounts } from "../../usecases/trip-plan/party-counts";
import { element, control } from "./trip-workspace-elements";
import { iconMarkup } from "../shared/primitives";

export function partyMarkup(trip: Trip): string {
  const party = trip.request.party;
  return `<span class="trip-party-part">${iconMarkup("account")}大人 ${party ? `${party.adults}人` : "未定"}</span><span class="trip-party-part">${iconMarkup("child")}子ども ${party ? `${party.children.length}人` : "未定"}</span>`;
}
export function renderTripPartyControl(trip: Trip, controller: TripWorkspaceController, report: (text: string) => void): HTMLElement {
  const root = element("div", "trip-party-control"), form = element("form", "trip-party-editor"); form.hidden = true;
  const session = controller.sessionId(), trigger = control("", () => { openTripEditor(form, "人数を変更"); adults.focus(); });
  trigger.innerHTML = partyMarkup(trip); trigger.setAttribute("aria-label", "人数を変更");
  const count = (name: string, value: number) => { const label = element("label", "", name), input = element("input"); input.type = "number"; input.min = "0"; input.max = "100"; input.step = "1"; input.required = true; input.value = String(value); label.append(input); form.append(label); return input; };
  const adults = count("大人", trip.request.party?.adults ?? 1), children = count("子ども", trip.request.party?.children.length ?? 0);
  const submit = element("button", "", "確定"); submit.type = "submit";
  form.append(submit, control("取消", () => { form.hidden = true; trigger.focus(); }));
  form.addEventListener("submit", async event => { event.preventDefault(); const current = controller.current();
    if (current?.id !== trip.id || current.revision !== trip.revision || controller.sessionId() !== session) { report("最新の旅程から人数を変更してください。"); return; }
    try { if (await saveTripEdit(form, submit, controller, proposeUserParty(current, partyWithCounts(current.request.party, Number(adults.value), Number(children.value))), report)) { form.hidden = true; const dialog = form.closest("dialog"); if (dialog?.open) dialog.close(); } }
    catch (error) { report(error instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(error.message) ? error.message : "人数と旅行者の構成を確認してください。構成の変更は相談から行えます。"); }
  });
  if (controller.source()?.getRole?.() === "viewer") { const text = element("span", "trip-party-pair"); text.innerHTML = partyMarkup(trip); root.append(text); } else root.append(trigger, form); return root;
}
