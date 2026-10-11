import type { Trip } from "@raiquora/trip/trip";
import { tripConsultationTopics, type TripConsultationTopic } from "../../domain/trip-consultation-topics";
import { control, element } from "./trip-workspace-elements";

export function openTripConsultation(trip: Trip, select: (topic?: TripConsultationTopic) => void): HTMLDialogElement {
  const dialog = element("dialog", "trip-editor-dialog trip-consultation-dialog");
  dialog.setAttribute("aria-label", "どれについて相談しますか？");
  dialog.append(element("h2", "", "どれについて相談しますか？"));
  const anchor = document.activeElement as HTMLElement | null;
  const choose = (topic?: TripConsultationTopic) => { dialog.close(); select(topic); };
  const topics = tripConsultationTopics(trip);
  for (const [section, title] of [["undecided", "これから決めること"], ["review", "決めた内容を見直す"]] as const) {
    const entries = topics.filter(topic => topic.section === section);
    if (!entries.length) continue;
    dialog.append(element("h3", "", title));
    const list = element("div", "trip-consultation-options");
    for (const topic of entries) {
      const button = control("", () => choose(topic));
      if (topic.context) button.append(element("small", "trip-consultation-context", topic.context));
      button.append(element("span", "", topic.label)); list.append(button);
    }
    dialog.append(list);
  }
  if (!topics.some(topic => topic.section === "undecided")) dialog.append(element("p", "trip-workspace-copy", "登録内容に未決定の項目はありません。ほかのことも相談できます。"));
  const actions = element("div", "trip-form-actions");
  actions.append(control("閉じる", () => dialog.close()), control("ほかのことを相談", () => choose())); dialog.append(actions);
  dialog.addEventListener("close", () => { dialog.remove(); if (anchor?.isConnected) anchor.focus(); }, { once: true });
  (document.getElementById("app") ?? document.body).append(dialog); dialog.showModal();
  return dialog;
}
