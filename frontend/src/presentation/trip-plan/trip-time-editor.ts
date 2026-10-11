import { saveTripEdit } from "./save-trip-edit";
import { openTripEditor } from "./trip-editor-dialog";
import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import type { DayEntry } from "@raiquora/trip/daily-itinerary";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { proposeTripItemChange } from "@raiquora/trip/trip-item-proposal";
import { plannedTimeInput } from "../../usecases/trip-plan/planned-time-input";
import { element, control } from "./trip-workspace-elements";

/** User intent only; provider train times remain bound to a selected route. */
export function renderTripTimeEditor(trip: Trip, item: ItineraryItem, entry: DayEntry | undefined, controller: TripWorkspaceController, report: (message: string) => void): HTMLElement {
  const root = element("div", "trip-time-control"), form = element("form", "trip-time-editor"); form.hidden = true;
  const session = controller.sessionId(), s = item.schedule;
  const role = item.type === "stay" ? entry?.role === "end" ? "checkOut" : "checkIn" : undefined;
  if (item.type === "stay" && entry?.role === "continue") { root.append(element("span", "trip-time-label", "連泊")); return root; }
  const instant = item.type === "stay" ? item.plannedTiming?.[role!] : s.type === "fixed" ? s.startAt : undefined;
  const caption = item.type === "stay" ? role === "checkOut" ? "チェックアウト" : "チェックイン" : "時刻";
  const displayed = s.type === "fixed" && entry?.role === "end" ? s.endAt : instant;
  const time = displayed?.at.slice(11, 16);
  const provider = item.type === "transport" && item.detail.status === "selected" && (item.detail.mode === "rail" || item.detail.provenance.type === "provider");
  if (provider || controller.source()?.getRole?.() === "viewer") { root.append(element("span", "trip-time-label", time ?? "未定")); return root; }
  const trigger = control(time ?? "未定", () => { openTripEditor(form, "予定の時刻"); date.focus(); });
  trigger.setAttribute("aria-label", `${item.title}の${caption}を登録`);
  const input = (labelText: string, type: string, value: string, required = true) => {
    const label = element("label", "", labelText), field = element("input"); field.type = type; field.value = value; field.required = required; label.append(field); form.append(label); return field;
  };
  const dateValue = instant?.at.slice(0, 10) ?? (item.type === "stay" && item.selection.status === "selected" ? role === "checkOut" ? item.selection.accommodation.checkOutDate : item.selection.accommodation.checkInDate : entry?.localDate ?? (s.type === "day" ? role === "checkOut" ? s.endDate ?? s.date : s.date : ""));
  const date = input("日付", "date", dateValue), start = input(caption, "time", instant?.at.slice(11, 16) ?? "");
  const end = item.type === "stay" ? undefined : input("終了時刻（任意・同日）", "time", s.type === "fixed" ? s.endAt?.at.slice(11, 16) ?? "" : "", false);
  const endDate = item.type === "stay" ? undefined : input("終了日（任意）", "date", s.type === "fixed" ? s.endAt?.at.slice(0, 10) ?? "" : "", false);
  const zone = input("タイムゾーン", "text", instant?.timeZone ?? entry?.timeZone ?? (s.type === "day" ? s.timeZone ?? "Asia/Tokyo" : "Asia/Tokyo"));
  zone.placeholder = "例：Asia/Tokyo";
  const offset = input("UTC差（夏時間が重複する場合）", "text", "", false); offset.placeholder = "+09:00";
  const advanced = element("details", "trip-time-advanced");
  advanced.append(element("summary", "", "タイムゾーン・夏時間の設定"), zone.parentElement!, offset.parentElement!);
  advanced.open = zone.value !== "Asia/Tokyo";
  form.append(advanced);
  const submit = element("button", "", "確定"); submit.type = "submit";
  form.append(submit, control("取消", () => { form.hidden = true; trigger.focus(); }));
  form.addEventListener("submit", async event => {
    event.preventDefault(); const latest = controller.current();
    if (!latest || latest.id !== trip.id || JSON.stringify(latest.items.find(i => i.id === item.id)) !== JSON.stringify(item) || controller.sessionId() !== session) { report("旅程が更新されました。最新の予定から時刻を入力し直してください。"); return; }
    try {
      const at = plannedTimeInput(date.value, start.value, zone.value, offset.value || undefined);
      const proposal = proposeTripItemChange(latest, item.type === "stay"
        ? { action: "set-stay-planned-time", itemId: item.id, plannedTiming: { ...item.plannedTiming, [role!]: at } }
        : { action: "set-planned-time", itemId: item.id, startAt: at, ...(end?.value ? { endAt: plannedTimeInput(endDate?.value || date.value, end.value, zone.value, offset.value || undefined) } : {}) });
      if (await saveTripEdit(form, submit, controller, proposal, report)) { form.hidden = true; const dialog = form.closest("dialog"); if (dialog?.open) dialog.close(); }
    } catch (error) { report(error instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(error.message) ? error.message : "予定の日付とタイムゾーンを確認してください。日程未定の宿は先に宿泊日を設定してください。"); }
  });
  root.append(trigger, form); return root;
}
