import type { ActivityCategory, ActivityItineraryItem } from "@raiquora/trip/trip";
import { itineraryScheduleLabel } from "./itinerary-schedule-label";

const labels: Record<ActivityCategory, string> = { sightseeing: "観光", food: "食事", experience: "体験", event: "イベント",
  shopping: "買い物", relaxation: "休憩", "free-time": "自由時間", other: "その他" };
/** Application response projection used by the existing presenter; no writer or UI Trip. */
export function activityPreview(item: ActivityItineraryItem): string {
  return [itineraryScheduleLabel(item.schedule), item.title, labels[item.category], item.place?.name].filter(Boolean).join("\n\n");
}
