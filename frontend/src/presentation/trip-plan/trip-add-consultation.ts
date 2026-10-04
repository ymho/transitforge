import type { Trip } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";

/** Send the clicked day/entry as traveller-visible context; IDs stay in uiFocus. */
export function tripAddConsultation(trip: Trip, dayKey: string, afterId?: string, title?: string): { prompt: string; itemId?: string } {
  const projection = projectDailyItinerary(trip, { limit: 90 });
  const day = projection.days.find(value => value.dayKey === dayKey);
  const entries = day?.entries ?? (dayKey === "unscheduled" ? projection.unscheduled : []);
  const index = afterId ? entries.findIndex(entry => entry.sourceItemId === afterId) : -1;
  const anchor = index >= 0 ? trip.items.find(item => item.id === afterId) : undefined;
  const entry = index >= 0 ? entries[index] : undefined;
  const next = index >= 0 ? trip.items.find(item => item.id === entries[index + 1]?.sourceItemId) : undefined;
  const role = anchor?.type === "stay" ? entry?.role === "end" ? "のチェックアウト" : entry?.role === "continue" ? "の滞在" : "のチェックイン" : "";
  const date = day?.localDate ?? day?.label;
  const position = anchor ? `${date ? `${date}の` : ""}「${anchor.title}」${role}の後${next ? `、次の「${next.title}」の前` : ""}`
    : date ? `${date}の旅程` : "日時未定の旅程";
  return { prompt: `${position}に${title?.trim() ? `「${title.trim()}」を追加したい。` : "追加する予定を相談したい。"}`,
    ...(anchor ? { itemId: anchor.id } : {}) };
}
