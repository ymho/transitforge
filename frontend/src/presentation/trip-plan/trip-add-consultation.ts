import type { Trip } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";

/** Send the clicked day/entry as traveller-visible context; IDs stay in uiFocus. */
export function tripAddConsultation(trip: Trip, dayKey: string, afterId?: string, title?: string, options: { beforeId?: string; placeName?: string } = {}): { prompt: string; itemId?: string } {
  const projection = projectDailyItinerary(trip, { limit: 90 });
  const day = projection.days.find(value => value.dayKey === dayKey);
  const entries = day?.localDate
    ? projection.days.filter(value => value.localDate === day.localDate).flatMap(value => value.entries)
      .sort((a, b) => trip.items.findIndex(item => item.id === a.sourceItemId) - trip.items.findIndex(item => item.id === b.sourceItemId))
    : day?.entries ?? (dayKey === "unscheduled" ? projection.unscheduled : []);
  const index = afterId ? entries.findIndex(entry => entry.sourceItemId === afterId) : -1;
  const anchor = index >= 0 ? trip.items.find(item => item.id === afterId) : undefined;
  const entry = index >= 0 ? entries[index] : undefined;
  const nextId = options.beforeId ?? (index >= 0 ? entries[index + 1]?.sourceItemId : undefined);
  const next = entries.some(entry => entry.sourceItemId === nextId) ? trip.items.find(item => item.id === nextId) : undefined;
  const role = anchor?.type === "stay" ? entry?.role === "end" ? "のチェックアウト" : entry?.role === "continue" ? "の滞在" : "のチェックイン" : "";
  const date = day?.localDate ?? day?.label;
  const position = anchor ? `${date ? `${date}の` : ""}「${anchor.title}」${role}の後${next ? `、次の「${next.title}」の前` : ""}`
    : next ? `${date ? `${date}の` : ""}最初の予定「${next.title}」の前` : date ? `${date}の旅程` : "日時未定の旅程";
  return { prompt: `${position}に${title?.trim() ? `予定を追加したい。\n希望：${title.trim()}` : "追加する予定を相談したい。"}${options.placeName?.trim() ? `\n場所名：${options.placeName.trim()}` : ""}`,
    ...(anchor ? { itemId: anchor.id } : {}) };
}
