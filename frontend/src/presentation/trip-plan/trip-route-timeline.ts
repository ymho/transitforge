import { transportModeLabel } from "../../usecases/trip-plan/transport-preview";
import type { TransportItineraryItem } from "@raiquora/trip/trip";
import { element } from "./trip-workspace-elements";
import { iconMarkup } from "../shared/primitives";
import { e5489SearchLink } from "../../usecases/trip-plan/e5489-search-link";

export function renderTripRouteTimeline(item: TransportItineraryItem): HTMLElement {
  const route = element("details", "trip-route"); route.open = false;
  if (item.detail.status !== "selected") { route.append(element("summary", "", "交通手段未選択")); return route; }
  if (item.detail.mode !== "rail") {
    route.append(element("summary", "", `${transportModeLabel(item.detail.mode)}・${item.detail.origin.name} → ${item.detail.destination.name}`)); return route;
  }
  const { legs } = item.detail.journey;
  route.append(element("summary", "", `${legs[0]!.origin.name} → ${legs[legs.length - 1]!.destination.name}・${legs[legs.length - 1]!.scheduledArrival.at.slice(11, 16)}着・乗換${legs.length - 1}回`));
  const list = element("ol", "trip-route-legs");
  legs.forEach((leg, index) => {
    const row = element("li", "trip-route-leg"), icon = element("span"); icon.innerHTML = iconMarkup("train");
    row.append(element("span", "trip-route-time", `${leg.scheduledDeparture.at.slice(11, 16)} 発`), icon,
      element("strong", "", leg.origin.name), element("p", "trip-route-service", `${[leg.serviceType, leg.trainName, leg.trainNumber].filter(Boolean).join(" ")}${leg.serviceDestination ? `・${leg.serviceDestination}行` : ""}`),
      element("span", "trip-route-time", `${leg.scheduledArrival.at.slice(11, 16)} 着`), element("span", "", leg.destination.name));
    list.append(row);
    const next = legs[index + 1];
    if (next) {
      const minutes = Math.round((Date.parse(next.scheduledDeparture.at) - Date.parse(leg.scheduledArrival.at)) / 60000);
      const transfer = element("li", "trip-route-transfer", `${leg.destination.name}${leg.destination.name !== next.origin.name ? ` → ${next.origin.name}` : ""}・乗換${minutes}分`);
      transfer.append(element("small", "", "徒歩・待ち時間の内訳未取得")); list.append(transfer);
    }
  });
  route.append(list);
  const href = e5489SearchLink(item.detail.journey);
  if (href) {
    const link = element("a", "trip-route-booking");
    link.setAttribute("aria-label", "e5489で予約（新しいタブで開く）");
    const logo = element("img");
    logo.src = "https://www.jr-odekake.net/assets/img/logo_e5489.svg";
    logo.alt = "e5489"; logo.referrerPolicy = "no-referrer";
    link.append(logo);
    link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.referrerPolicy = "no-referrer";
    link.title = "出発駅・到着駅・出発日時で検索（列車・乗換指定なし）";
    route.append(link);
  }
  return route;
}
