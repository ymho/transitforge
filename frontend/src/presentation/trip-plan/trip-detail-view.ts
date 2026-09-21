import { projectTripPlaces, uniqueTripPlaces } from "@raiquora/trip/trip-places";
import type { Trip } from "@raiquora/trip/trip";
import { effectiveTripConstraints } from "@raiquora/trip/trip-request";
import { element, control } from "./trip-workspace-elements";

export type TripDetailTab = "overview" | "itinerary" | "costs" | "map";
export const tripDetailTabs: readonly { id: TripDetailTab; label: string }[] = [
  { id: "overview", label: "概要" }, { id: "itinerary", label: "旅程" },
  { id: "costs", label: "費用" }, { id: "map", label: "地図" },
];

export function tripOverviewCopy(trip: Trip): readonly string[] {
  const constraints = effectiveTripConstraints(trip.request);
  const origin = constraints.find((entry) => entry.requirement.type === "origin")?.requirement;
  const dates = constraints.find((entry) => entry.requirement.type === "dates")?.requirement;
  return [
    trip.request.goal ? `旅のテーマ: ${trip.request.goal}` : "旅のテーマは未設定",
    origin?.type === "origin" ? `出発地: ${origin.place.name}` : "出発地は未確認",
    dates?.type === "dates" ? `日程: ${dates.start.earliest}〜${dates.end?.latest ?? "終了日未定"}` : "日程は未定",
    trip.items.length ? `採用済みの予定: ${trip.items.length}件` : "採用済みの予定はありません",
  ];
}

export function tripMapProjection(trip: Trip) {
  const projection = projectTripPlaces(trip);
  const places = uniqueTripPlaces(projection.visitedPlaces).map((entry) => ({
    itemId: entry.itemId, name: entry.place.name, role: entry.role,
    ...(entry.place.coordinate ? { coordinate: entry.place.coordinate } : {}),
  }));
  return {
    places,
    located: places.filter((entry) => entry.coordinate !== undefined),
    unknown: places.filter((entry) => entry.coordinate === undefined),
  };
}

export function renderTripMap(trip: Trip, openMap: (itemId?: string) => void, focus: (itemId: string) => void): HTMLElement {
  const root = element("section", "trip-detail-map");
  const view = tripMapProjection(trip);
  root.append(element("h2", "", "旅程の地図"));
  if (!view.places.length) {
    root.append(element("p", "trip-workspace-copy", "地図に表示できる採用済み地点はまだありません。"));
    return root;
  }
  root.append(element("p", "trip-workspace-copy", view.located.length
    ? `${view.located.length}地点を保存済みの座標から表示できます。`
    : "保存済みの座標がないため、地点一覧だけを表示しています。"));
  const list = element("ul", "trip-detail-map-list");
  for (const place of view.places) {
    const row = element("li"); const select = control(place.name, () => { focus(place.itemId); if (place.coordinate) openMap(place.itemId); });
    select.dataset.itemId = place.itemId;
    row.append(select, element("span", place.coordinate ? "" : "trip-cost-warning", place.coordinate ? "座標確認済み" : "座標未確認")); list.append(row);
  }
  root.append(list);
  root.append(control("地図で旅程の地点・経路を見る", () => openMap()));
  root.append(element("p", "trip-workspace-copy", "経路形状を確認できない区間は、直線で補完しません。"));
  return root;
}
