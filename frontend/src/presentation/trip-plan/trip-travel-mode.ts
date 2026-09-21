import { inTripItem, type ContextItem, type InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import type { Trip } from "@raiquora/trip/trip";
import { itineraryScheduleLabel } from "../../usecases/trip-plan/itinerary-schedule-label";
import { control, element } from "./trip-workspace-elements";

export function tripTravelModeProjection(trip: Trip, now: Date, snapshot?: InTripContextSnapshot) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid travel mode clock");
  if (snapshot && (snapshot.trip.id !== trip.id || snapshot.trip.revision !== trip.revision)) throw new Error("Stale in-trip context");
  const items = snapshot ? [...snapshot.itinerary.current, ...snapshot.itinerary.next, ...snapshot.itinerary.upcoming, ...snapshot.itinerary.uncertain]
    : trip.items.map((item) => inTripItem(item, { at: now.toISOString(), timeZone: "UTC" }));
  const current = snapshot?.itinerary.current ?? items.filter((item) => ["current", "possible-current", "date-current"].includes(item.position)).slice(0, 2);
  const next = snapshot?.itinerary.next ?? items.filter((item) => item.position === "upcoming").slice(0, 2);
  const uncertain = snapshot?.itinerary.uncertain ?? items.filter((item) => item.position === "unknown").slice(0, 2);
  return { mode: trip.lifecycleState === "in_trip" ? "live" as const : "preview" as const, current, next, uncertain,
    finished: !current.length && !next.length && !uncertain.length && items.some((item) => item.position === "past") };
}

function item(root: HTMLElement, value: ContextItem, focus: (id: string) => void) {
  const card = element("article", "trip-travel-item"); card.dataset.itemId = value.itemId;
  card.append(element("h3", "", value.title), element("p", "", itineraryScheduleLabel(value.schedule)));
  if (value.rail?.length) for (const rail of value.rail) card.append(element("p", "", `${rail.trainNumber} ${rail.origin} → ${rail.destination}\n計画: ${rail.departure.at} → ${rail.arrival.at}`));
  else if (value.origin && value.destination) card.append(element("p", "", `${value.origin} → ${value.destination}`));
  else if (value.placeName) card.append(element("p", "", value.placeName));
  card.append(control("この予定を地図で見る", () => focus(value.itemId))); root.append(card);
}

export function renderTripTravelMode(options: { trip: Trip; now: Date; snapshot?: InTripContextSnapshot; unavailable?: boolean;
  back(): void; ask(text: string): void; focus(itemId: string): void }): HTMLElement {
  const root = element("section", "trip-travel-mode"); const view = tripTravelModeProjection(options.trip, options.now, options.snapshot);
  const header = element("header"); header.append(control("旅程詳細へ戻る", options.back), element("h1", "", options.trip.title)); root.append(header);
  root.append(element("p", "trip-travel-mode-label", view.mode === "live" ? "旅行中の予定" : "予定上の旅行モード（プレビュー）"));
  root.append(element("p", "trip-workspace-copy", view.mode === "live"
    ? "時刻表から予定上の現在・次を表示しています。実際の乗車・到着・訪問を示すものではありません。"
    : "この画面を開いても旅行状態、完了実績、予約は変更されません。"));
  const group = (title: string, values: readonly ContextItem[]) => { const section = element("section"); section.append(element("h2", "", title));
    if (!values.length) section.append(element("p", "", "該当する予定はありません。")); else values.forEach((value) => item(section, value, options.focus)); root.append(section); };
  group("予定上の現在", view.current); group("次の予定", view.next); if (view.uncertain.length) group("日時未定", view.uncertain);
  if (view.finished) root.append(element("p", "", "予定時刻上はすべて終了しています。完了実績は自動では記録しません。"));
  const facts = element("section", "trip-travel-facts"); facts.append(element("h2", "", "運行・天気・予約"));
  if (options.unavailable) facts.append(element("p", "trip-cost-warning", "最新情報を取得できませんでした。平常・晴れ・予約済みとは判断していません。"));
  else if (!options.snapshot) facts.append(element("p", "", "プレビューでは現在の運行・天気・予約情報を表示しません。"));
  else {
    facts.append(element("p", "", `運行・天気: ${options.snapshot.impacts.status === "available" ? "取得済み" : options.snapshot.impacts.status === "unavailable" ? "取得不能" : "未確認"}`));
    for (const impact of options.snapshot.impacts.items) facts.append(element("p", impact.status === "impact" ? "trip-cost-warning" : "", `${impact.status === "impact" ? "注意あり" : impact.status === "no-impact" ? "影響なし（取得範囲）" : "影響未確認"} / 観測 ${impact.observedAt} / 有効期限 ${impact.expiresAt}`));
    facts.append(element("p", "", `予約記録: ${options.snapshot.reservations.status === "available" ? `${options.snapshot.reservations.items.length}件` : options.snapshot.reservations.status === "unavailable" ? "取得不能" : "未確認"}`));
  }
  root.append(facts, control("この旅についてAIに相談", () => options.ask("この旅の現在と次の予定について相談したい")));
  return root;
}
