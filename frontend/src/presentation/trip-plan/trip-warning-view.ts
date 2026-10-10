import { element } from "./trip-workspace-elements";

export function renderTripWarnings(messages: readonly string[]): HTMLElement | undefined {
  const unique = [...new Set(messages.filter(Boolean))]; if (!unique.length) return undefined;
  const box = element("details", "trip-warning-box");
  const summary = element("summary", "", `確認が必要なこと（${unique.length}件）`);
  const icon = element("span", "", "⚠"); icon.setAttribute("aria-hidden", "true"); summary.prepend(icon);
  const list = element("ul"); for (const message of unique) list.append(element("li", "", message));
  box.append(summary, list); return box;
}
