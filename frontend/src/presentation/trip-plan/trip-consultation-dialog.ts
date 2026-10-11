import type { Trip } from "@raiquora/trip/trip";
import { tripConsultationExamples, type TripConsultationTopic } from "../../domain/trip-consultation-topics";
import { control, element } from "./trip-workspace-elements";

export function openTripConsultation(trip: Trip, select: (topic: Pick<TripConsultationTopic, "prompt" | "itemId">) => void): HTMLDialogElement {
  const dialog = element("dialog", "trip-editor-dialog trip-consultation-dialog");
  dialog.setAttribute("aria-label", "どれについて相談しますか？");
  dialog.append(element("h2", "", "どれについて相談しますか？"));
  const anchor = document.activeElement as HTMLElement | null;
  const choose = (topic: Pick<TripConsultationTopic, "prompt" | "itemId">) => { dialog.close(); select(topic); };
  const topics = tripConsultationExamples(trip);
  if (topics.length) {
    dialog.append(element("p", "trip-consultation-caption", "たとえば、こんな相談"));
    const list = element("div", "trip-consultation-options");
    for (const topic of topics) {
      const button = control("", () => choose(topic));
      if (topic.context) button.append(element("small", "trip-consultation-context", topic.context));
      button.append(element("span", "", topic.label)); list.append(button);
    }
    dialog.append(list);
  }
  const form = element("form", "trip-consultation-form");
  const label = element("label", "", "ほかのことを相談");
  const input = element("textarea"); input.name = "consultation"; input.rows = 3; input.maxLength = 2000; input.required = true;
  input.placeholder = "気になることや、決めたいことを教えてください";
  label.append(input); form.append(label);
  const actions = element("div", "trip-form-actions trip-consultation-actions");
  const submit = element("button", "", "相談する"); submit.type = "submit"; submit.disabled = true;
  input.addEventListener("input", () => { submit.disabled = !input.value.trim(); });
  actions.append(control("閉じる", () => dialog.close()), submit); form.append(actions); dialog.append(form);
  form.addEventListener("submit", event => {
    event.preventDefault(); const prompt = input.value.trim();
    if (prompt) choose({ prompt });
  });
  dialog.addEventListener("close", () => { dialog.remove(); if (anchor?.isConnected) anchor.focus(); }, { once: true });
  (document.getElementById("app") ?? document.body).append(dialog); dialog.showModal();
  dialog.tabIndex = -1; dialog.focus();
  return dialog;
}
