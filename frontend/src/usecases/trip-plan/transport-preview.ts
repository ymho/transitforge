import type { TransportItineraryItem } from "@raiquora/trip/trip";
import type { TransportMode } from "@raiquora/trip/transport-detail";
import { itineraryScheduleLabel } from "./itinerary-schedule-label";

const labels: Record<TransportMode, string> = { rail: "🚆 鉄道", air: "✈ 飛行機", bus: "🚌 バス", ferry: "⛴ フェリー", car: "🚗 車",
  "rental-car": "🚗 レンタカー", taxi: "🚕 タクシー", "ride-hail": "🚕 配車", walk: "🚶 徒歩", bicycle: "🚲 自転車", other: "移動" };
export function transportPreview(item: TransportItineraryItem): string {
  const d = item.detail;
  const heading = d.mode ? labels[d.mode] : "移動手段未定";
  if (d.status === "unresolved") return [heading, item.title, itineraryScheduleLabel(item.schedule, true), "移動の詳細未確定"].join("\n\n");
  const route = d.mode === "rail" ? d.journey.legs.map((leg) =>
    `${leg.origin.name} → ${leg.destination.name}：${leg.scheduledDeparture.at} 発 → ${leg.scheduledArrival.at} 着（${leg.trainNumber}・計画時刻）`).join("\n\n") :
    `${d.origin.name} → ${d.destination.name}`;
  return [heading, route, itineraryScheduleLabel(item.schedule, true), d.mode !== "rail" && d.provenance.type === "manual" ? "手入力の移動予定（便・経路未検証）" : "採用した計画（予約状態は未確認）"].join("\n\n");
}
