import type { ConversationSessionRepository } from "../../../application/concierge/conversation-session-repository";
import type { ConversationSession } from "../../../domain/conversation-session";
import { loadTripPlan } from "../../../application/trip-plan/trip-plan-repository";

export interface ConversationHistoryPanelElements {
  newConversation: HTMLButtonElement;
  toggle: HTMLButtonElement;
  dialog: HTMLDialogElement;
  close: HTMLButtonElement;
  list: HTMLOListElement;
  empty: HTMLParagraphElement;
  storage: Pick<Storage, "getItem">;
  repository: ConversationSessionRepository;
  onSessionSelected: (sessionId: string) => void;
  confirmDelete?: (title: string) => boolean;
}

export interface ConversationHistoryListItem {
  id: string;
  title: string;
  updatedLabel: string;
  active: boolean;
  hasTripPlan: boolean;
}

export function configureConversationHistoryPanel(
  elements: ConversationHistoryPanelElements,
): () => void {
  const {
    newConversation,
    toggle,
    dialog,
    close,
    list,
    empty,
    storage,
    repository,
    onSessionSelected,
  } = elements;
  const confirmDelete = elements.confirmDelete ?? ((title) =>
    window.confirm(`「${title}」を削除しますか？`));

  const render = () => {
    const activeId = repository.active()?.id;
    const items = conversationHistoryListItems(
      repository.list(),
      activeId,
      (sessionId) => loadTripPlan(storage, sessionId) !== undefined,
    );
    list.replaceChildren(...items.map((item) => historyRow(
      item,
      () => {
        repository.select(item.id);
        onSessionSelected(item.id);
      },
      () => {
        if (!confirmDelete(item.title)) return;
        const next = repository.delete(item.id);
        if (item.active) {
          onSessionSelected(next.id);
          return;
        }
        render();
      },
    )));
    empty.hidden = items.length !== 0;
  };

  newConversation.addEventListener("click", () => {
    const session = repository.create();
    onSessionSelected(session.id);
  });
  toggle.addEventListener("click", () => {
    render();
    dialog.showModal();
    list.querySelector<HTMLButtonElement>("[aria-current='true']")?.focus();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => toggle.focus());
  const unsubscribe = repository.subscribe(() => {
    if (dialog.open) render();
  });
  return unsubscribe;
}

export function conversationHistoryListItems(
  sessions: ConversationSession[],
  activeSessionId: string | undefined,
  hasTripPlan: (sessionId: string) => boolean,
  now = new Date(),
): ConversationHistoryListItem[] {
  return [...sessions]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .flatMap((session) => {
      const sessionHasTripPlan = hasTripPlan(session.id);
      if (session.title === "新しい会話" && !session.summary && !sessionHasTripPlan) {
        return [];
      }
      return [{
        id: session.id,
        title: session.title,
        updatedLabel: conversationUpdatedLabel(session.updatedAt, now),
        active: session.id === activeSessionId,
        hasTripPlan: sessionHasTripPlan,
      }];
    });
}

export function conversationUpdatedLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新日時不明";
  const elapsedDays = Math.floor(
    calendarDayIndex(now) - calendarDayIndex(date),
  );
  if (elapsedDays === 0) {
    return new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(date);
  }
  if (elapsedDays === 1) return "昨日";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function historyRow(
  item: ConversationHistoryListItem,
  select: () => void,
  remove: () => void,
): HTMLLIElement {
  const row = document.createElement("li");
  if (item.active) row.dataset.active = "true";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "conversation-history-open";
  open.ariaCurrent = item.active ? "true" : null;
  const title = document.createElement("strong");
  title.textContent = item.title;
  const metadata = document.createElement("span");
  metadata.textContent = [
    item.updatedLabel,
    ...(item.hasTripPlan ? ["旅程あり"] : []),
  ].join(" · ");
  open.append(title, metadata);
  open.addEventListener("click", select);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "conversation-history-delete";
  deleteButton.ariaLabel = `${item.title}を削除`;
  deleteButton.textContent = "削除";
  deleteButton.addEventListener("click", remove);
  row.append(open, deleteButton);
  return row;
}

function calendarDayIndex(value: Date): number {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(number("year"), number("month") - 1, number("day")) / 86_400_000;
}
