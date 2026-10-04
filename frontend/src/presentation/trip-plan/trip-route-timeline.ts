import { transportModeLabel } from "../../usecases/trip-plan/transport-preview";
import type { TransportItineraryItem } from "@raiquora/trip/trip";
import { element } from "./trip-workspace-elements";
import { iconMarkup } from "../shared/primitives";

export function renderTripRouteTimeline(item: TransportItineraryItem): HTMLElement {
  const route = element("details", "trip-route"); route.open = true;
  if (item.detail.status !== "selected") { route.append(element("summary", "", "交通手段未選択")); return route; }
  if (item.detail.mode !== "rail") {
    route.append(element("summary", "", `${transportModeLabel(item.detail.mode)}・${item.detail.origin.name} → ${item.detail.destination.name}`)); return route;
  }
  const { legs } = item.detail.journey;
  route.append(element("summary", "", `経路・乗換${legs.length - 1}回`));
  const list = element("ol", "trip-route-legs");
  legs.forEach((leg, index) => {
    const row = element("li", "trip-route-leg"), icon = element("span"); icon.innerHTML = iconMarkup("train");
    row.append(element("span", "trip-route-time", `${leg.scheduledDeparture.at.slice(11, 16)} 発`), icon,
      element("strong", "", leg.origin.name), element("p", "trip-route-service", `列車 ${leg.trainNumber}`),
      element("span", "trip-route-time", `${leg.scheduledArrival.at.slice(11, 16)} 着`), element("span", "", leg.destination.name));
    list.append(row);
    const next = legs[index + 1];
    if (next) {
      const minutes = Math.round((Date.parse(next.scheduledDeparture.at) - Date.parse(leg.scheduledArrival.at)) / 60000);
      const transfer = element("li", "trip-route-transfer", `${leg.destination.name}${leg.destination.name !== next.origin.name ? ` → ${next.origin.name}` : ""}・乗換${minutes}分`);
      transfer.append(element("small", "", "徒歩・待ち時間の内訳未取得")); list.append(transfer);
    }
  });
  route.append(list); return route;
}
