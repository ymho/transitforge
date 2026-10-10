import { applyTripProposal, type Trip, type ItineraryItem, type TripUpdateProposal } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";

export function tripOrderDays(trip: Trip) {
  const days = projectDailyItinerary(trip, { limit: 90 }).days;
  return [...days.map((day, index) => ({ key: day.dayKey, label: day.localDate ?? (day.label === day.logicalDayId ? `${index + 1}日目` : day.label),
    schedule: day.logicalDayId ? { type: "relative" as const, dayId: day.logicalDayId }
      : { type: "day" as const, date: day.localDate!, ...(day.timeZone ? { timeZone: day.timeZone } : {}) } })),
    { key: "unscheduled", label: "日付未定", schedule: { type: "unscheduled" as const } }];
}
export function tripOrderDay(trip: Trip, itemId: string): string {
  return projectDailyItinerary(trip, { limit: 90 }).days.find(day => day.entries.some(entry => entry.sourceItemId === itemId))?.dayKey ?? "unscheduled";
}
export interface TripOrderChange { readonly itemId: string; readonly dayKey: string; }

/** Only explicitly moved items lose their times; shifted neighbours remain untouched. */
export function proposeTripOrder(trip: Trip, order: readonly string[], changes: readonly TripOrderChange[] = []): TripUpdateProposal | undefined {
  if (order.length !== trip.items.length || new Set(order).size !== order.length || order.some(id => !trip.items.some(item => item.id === id))) throw new Error("Invalid Trip order");
  const original = trip.items.map(item => item.id), days = tripOrderDays(trip);
  if (new Set(changes.map(change => change.itemId)).size !== changes.length) throw new Error("Duplicate move");
  const effective = changes.filter(change => original.indexOf(change.itemId) !== order.indexOf(change.itemId) || tripOrderDay(trip, change.itemId) !== change.dayKey);
  if (!effective.length && order.every((id, index) => original[index] === id)) return undefined;
  const changed = new Set(effective.map(change => change.itemId));
  if (JSON.stringify(original.filter(id => !changed.has(id))) !== JSON.stringify(order.filter(id => !changed.has(id)))) throw new Error("Unchanged items cannot be moved");
  const patches: TripUpdateProposal["patches"][number][] = [];
  for (const change of effective) {
    const item = trip.items.find(item => item.id === change.itemId), day = days.find(day => day.key === change.dayKey);
    if (!item || !day || item.type === "transport") throw new Error("移動予定は並べ替えできません");
    const sameDay = tripOrderDay(trip, item.id) === change.dayKey;
    if (item.type === "stay" && item.selection.status === "selected" && !sameDay) throw new Error("宿泊日を変更するには宿を選び直してください");
    const { logicalDayId: _oldDay, ...base } = item;
    let replacement: ItineraryItem = { ...base, schedule: day.schedule };
    if (item.type === "stay") {
      const { plannedTiming: _times, ...stay } = replacement as typeof item;
      replacement = { ...stay, ...(sameDay ? { schedule: item.schedule, ...(item.logicalDayId ? { logicalDayId: item.logicalDayId } : {}) } : {}) };
    }
    patches.push({ type: "replace", itemId: item.id, item: replacement });
  }
  for (const itemId of order.filter(id => changed.has(id))) {
    const index = order.indexOf(itemId);
    patches.push({ type: "move", itemId, ...(index ? { afterId: order[index - 1]! } : {}) });
  }
  const proposal: TripUpdateProposal = { tripId: trip.id, baseRevision: trip.revision, summary: "予定の順番・日付を変更（動かした予定の時刻は未設定）", patches };
  const after = applyTripProposal(trip, proposal);
  if (JSON.stringify(after.items.map(item => item.id)) !== JSON.stringify(order)) throw new Error("Invalid moved item order");
  return proposal;
}
