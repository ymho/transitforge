import { projectDailyItinerary } from "./daily-itinerary";
import { createPlaceSnapshot } from "./place-snapshot";
import { nonRailTransportModes, type NonRailTransportMode } from "./transport-detail";
import { exactKeys } from "./snapshot-validation";
import { applyTripProposal, activityCategories, type ActivityCategory, type ItineraryItem, type Trip, type TripUpdateProposal } from "./trip";

/** Shared Application operation for UI and Agent. It only accepts user-authored facts and current Trip references. */
export type TripItemChange =
  | { readonly action: "add-activity"; readonly itemId: string; readonly dayKey: string; readonly afterId?: string;
      readonly title: string; readonly category: ActivityCategory; readonly placeName?: string }
  | { readonly action: "add-researched-activity"; readonly itemId: string; readonly dayKey: string; readonly afterId?: string;
      readonly title: string; readonly category: ActivityCategory; readonly sourceUrl: string; readonly observedAt: string }
  | { readonly action: "add-transport" | "add-stay"; readonly itemId: string; readonly dayKey: string; readonly afterId?: string; readonly title: string }
  | { readonly action: "rename"; readonly itemId: string; readonly title: string }
  | { readonly action: "remove"; readonly itemId: string }
  | { readonly action: "move"; readonly itemId: string; readonly afterId?: string }
  | { readonly action: "change-day"; readonly itemId: string; readonly dayKey: string }
  | { readonly action: "select-manual-transport"; readonly itemId: string; readonly title: string;
      readonly mode: NonRailTransportMode; readonly origin: string; readonly destination: string }
  | { readonly action: "set-manual-activity-place"; readonly itemId: string; readonly placeName: string }
  | { readonly action: "set-manual-stay-place"; readonly itemId: string; readonly placeName: string };

export function proposeTripItemChange(trip: Trip, change: TripItemChange): TripUpdateProposal {
  const fields: Record<TripItemChange["action"], readonly string[]> = {
    "add-activity": ["action", "itemId", "dayKey", "afterId", "title", "category", "placeName"],
    "add-researched-activity": ["action", "itemId", "dayKey", "afterId", "title", "category", "sourceUrl", "observedAt"],
    "add-transport": ["action", "itemId", "dayKey", "afterId", "title"],
    "add-stay": ["action", "itemId", "dayKey", "afterId", "title"],
    rename: ["action", "itemId", "title"], remove: ["action", "itemId"], move: ["action", "itemId", "afterId"],
    "change-day": ["action", "itemId", "dayKey"],
    "select-manual-transport": ["action", "itemId", "title", "mode", "origin", "destination"],
    "set-manual-activity-place": ["action", "itemId", "placeName"],
    "set-manual-stay-place": ["action", "itemId", "placeName"],
  };
  if (!change || typeof change !== "object" || !Object.hasOwn(fields, change.action)) throw new Error("Invalid item change");
  exactKeys(change, fields[change.action]);
  const itemId = identifier(change.itemId), existing = trip.items.find(item => item.id === itemId);
  let patch: TripUpdateProposal["patches"][number];
  if (["add-activity", "add-researched-activity", "add-transport", "add-stay"].includes(change.action)) {
    if (existing) throw new Error("Item already exists");
    const input = change as Extract<TripItemChange, { action: "add-activity" | "add-researched-activity" | "add-transport" | "add-stay" }>;
    const day = resolveDay(trip, input.dayKey);
    if (input.afterId && !day?.entries.some(entry => entry.sourceItemId === input.afterId)) throw new Error("Insertion point is outside day");
    const schedule = daySchedule(day);
    const base = { id: itemId, title: label(input.title), schedule };
    let item: ItineraryItem;
    if (input.action === "add-activity" || input.action === "add-researched-activity") {
      if (!activityCategories.includes(input.category)) throw new Error("Invalid activity category");
      item = { ...base, type: "activity", category: input.category,
        ...(input.action === "add-researched-activity" ? { place: manualPlace(input.title), research: { sourceUrl: input.sourceUrl, observedAt: input.observedAt } }
          : input.placeName === undefined ? {} : { place: manualPlace(input.placeName) }) };
    } else if (input.action === "add-transport") item = { ...base, type: "transport", detail: { status: "unresolved" } };
    else item = { ...base, type: "stay", selection: { status: "unselected" } };
    const afterId = input.afterId ?? day?.entries.at(-1)?.sourceItemId;
    patch = { type: "add", item, ...(afterId ? { afterId } : {}) };
  } else {
    if (!existing) throw new Error("Item is not in the Trip");
    switch (change.action) {
      case "rename": patch = { type: "replace", itemId, item: { ...existing, title: label(change.title) } }; break;
      case "remove": patch = { type: "remove", itemId }; break;
      case "move": patch = { type: "move", itemId, ...(change.afterId === undefined ? {} : { afterId: identifier(change.afterId) }) }; break;
      case "change-day": patch = { type: "replace", itemId, item: { ...existing, schedule: daySchedule(resolveDay(trip, change.dayKey)) } }; break;
      case "select-manual-transport":
        if (existing.type !== "transport" || !nonRailTransportModes.includes(change.mode)) throw new Error("Non-rail transport item required");
        patch = { type: "replace", itemId, item: { ...existing, title: label(change.title), detail: { status: "selected", mode: change.mode,
          origin: manualPlace(change.origin), destination: manualPlace(change.destination), provenance: { type: "manual" } } } }; break;
      case "set-manual-activity-place":
        if (existing.type !== "activity") throw new Error("Activity item required");
        { const { research: _oldResearch, ...draft } = existing;
          patch = { type: "replace", itemId, item: { ...draft, place: manualPlace(change.placeName) } }; }
        break;
      case "set-manual-stay-place":
        if (existing.type !== "stay" || existing.selection.status !== "unselected") throw new Error("Unselected stay required");
        patch = { type: "replace", itemId, item: { ...existing, selection: { status: "unselected", place: manualPlace(change.placeName) } } }; break;
      default: throw new Error("Unsupported item change");
    }
  }
  const patches: TripUpdateProposal["patches"] = [patch,
    ...(["add-activity", "add-researched-activity", "add-transport", "add-stay", "select-manual-transport", "set-manual-activity-place", "set-manual-stay-place"].includes(change.action)
      ? [{ type: "planning" as const, state: trip.planningState === "itinerary_draft" || trip.planningState === "itinerary_refinement" ? "itinerary_refinement" as const : "itinerary_draft" as const }] : [])];
  const subject = existing?.title ?? ("title" in change ? label(change.title) : "予定");
  const proposal = { tripId: trip.id, baseRevision: trip.revision, summary: `${subject}の${change.action.startsWith("add-") ? "追加" : change.action === "remove" ? "削除" : ["move", "change-day"].includes(change.action) ? "移動" : "変更"}案`, patches };
  applyTripProposal(trip, proposal);
  return structuredClone(proposal);
}
function identifier(value: string): string { if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("Invalid item ID"); return value; }
function label(value: string): string { if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("Invalid title"); return value.normalize("NFKC").trim(); }
function manualPlace(value: string) { return createPlaceSnapshot({ name: label(value), sources: [] }, { origin: "manual" }); }
function resolveDay(trip: Trip, dayKey: string) {
  if (dayKey === "unscheduled") return undefined;
  const day = projectDailyItinerary(trip, { limit: 90 }).days.find(view => view.dayKey === dayKey);
  if (!day) throw new Error("Unknown or stale Trip day");
  return day;
}
function daySchedule(day: ReturnType<typeof resolveDay>) {
  return day?.logicalDayId ? { type: "relative" as const, dayId: day.logicalDayId }
    : day?.localDate ? { type: "day" as const, date: day.localDate, ...(day.timeZone ? { timeZone: day.timeZone } : {}) }
      : { type: "unscheduled" as const };
}
