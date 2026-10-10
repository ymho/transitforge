import { element } from "./trip-workspace-elements";

export function renderTripWarnings(messages: readonly string[], action = "確認した内容に合わせて、予定の日時や条件を修正してください。"): HTMLElement | undefined {
  const unique = [...new Set(messages.filter(Boolean))]; if (!unique.length) return undefined;
  const box = element("details", "trip-warning-box");
  const summary = element("summary", "", "確認");
  const icon = element("span", "", "⚠"); icon.setAttribute("aria-hidden", "true"); summary.prepend(icon);
  const list = element("ul"); for (const message of unique) list.append(element("li", "", message));
  box.append(summary, list, element("p", "trip-warning-action", action)); return box;
}
