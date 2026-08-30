import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { RestaurantCandidate } from "@raiquora/trip/restaurant-search";
import type { ViewerAgentExternalResponse } from "../../domain/viewer-agent-response";

export function renderExternalTravelInformation(
  response: ViewerAgentExternalResponse,
  options: { onRestaurantConsult?: (restaurant: RestaurantCandidate) => void } = {},
): HTMLElement {
  const container = document.createElement("section");
  container.className = "external-travel-cards";
  appendWeather(container, response.external.weather);
  appendAlerts(container, response.external.alerts);
  appendGroundAccess(container, response.external.groundAccess);
  appendRestaurants(container, response.external.restaurants, options.onRestaurantConsult);
  return container;
}

function appendAlerts(container: HTMLElement, alerts: ViewerAgentExternalResponse["external"]["alerts"]): void {
  if (alerts?.status !== "available" || !alerts.data || alerts.data.alerts.length === 0) return;
  const group = document.createElement("section");
  group.className = "external-alert-list";
  const heading = document.createElement("strong");
  heading.textContent = `${alerts.data.area}の防災情報`;
  group.append(heading);
  for (const alert of alerts.data.alerts.slice(0, 6)) {
    const card = document.createElement("article");
    card.dataset.severity = alert.severity;
    const title = document.createElement("strong"); title.textContent = alert.title;
    const summary = document.createElement("p"); summary.textContent = alert.summary;
    const source = document.createElement("a"); source.href = alert.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer"; source.textContent = `気象庁 ${new Date(alert.issuedAt).toLocaleString("ja-JP")}`;
    card.append(title, summary, source); group.append(card);
  }
  group.append(evidenceCaption(alerts)); container.append(group);
}

function appendGroundAccess(container: HTMLElement, access: ViewerAgentExternalResponse["external"]["groundAccess"]): void {
  if (access?.status !== "available" || !access.data) return;
  const card = document.createElement("article"); card.className = "external-ground-access";
  if ("destination" in access.data) card.textContent = `${access.data.origin.name}から${access.data.destination.name}まで ${access.data.durationMinutes}分・${Math.round(access.data.distanceMeters)}m`;
  else if ("entries" in access.data) card.textContent = `${access.data.origin.name}から候補地点までの所要時間を比較しました`;
  else card.textContent = `${access.data.origin.name}から${access.data.minutes}分の到達圏`;
  card.append(evidenceCaption(access)); container.append(card);
}

function appendRestaurants(
  container: HTMLElement,
  restaurants: ViewerAgentExternalResponse["external"]["restaurants"],
  onConsult?: (restaurant: RestaurantCandidate) => void,
): void {
  if (restaurants?.status !== "available" || !restaurants.data) return;
  const group = document.createElement("section"); group.className = "external-restaurant-list";
  const heading = document.createElement("strong"); heading.textContent = `${restaurants.data.area}の食事候補`;
  const cards = document.createElement("div"); cards.className = "external-restaurant-cards";
  for (const restaurant of restaurants.data.restaurants.slice(0, 6)) {
    const card = document.createElement("article");
    if (restaurant.imageUrl) { const image = document.createElement("img"); image.src = restaurant.imageUrl; image.alt = ""; image.loading = "lazy"; card.append(image); }
    const name = document.createElement("strong"); name.textContent = restaurant.name;
    const detail = document.createElement("span"); detail.textContent = [restaurant.genre, restaurant.budget, restaurant.access].filter(Boolean).join("　");
    const supplemental = document.createElement("small"); supplemental.textContent = [restaurant.averageBudget ? `平均 ${restaurant.averageBudget}` : undefined, restaurant.regularHoliday ? `定休 ${restaurant.regularHoliday}` : undefined].filter(Boolean).join("　");
    const features = document.createElement("div"); features.className = "external-restaurant-features";
    for (const feature of restaurant.features ?? []) { const chip = document.createElement("span"); chip.textContent = feature; features.append(chip); }
    const link = document.createElement("a"); link.href = restaurant.detailUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "詳細";
    card.append(name, detail);
    if (supplemental.textContent) card.append(supplemental);
    if (features.childElementCount > 0) card.append(features);
    card.append(link);
    if (onConsult) {
      const consult = document.createElement("button");
      consult.type = "button";
      consult.textContent = "この店を旅程に相談";
      consult.addEventListener("click", () => onConsult(restaurant));
      card.append(consult);
    }
    cards.append(card);
  }
  group.append(heading, cards, hotPepperCredit(), evidenceCaption(restaurants)); container.append(group);
}

function hotPepperCredit(): HTMLElement {
  const link = document.createElement("a");
  link.className = "external-restaurant-credit";
  link.href = "https://webservice.recruit.co.jp/";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = "ホットペッパーグルメ Webサービス";
  const image = document.createElement("img");
  image.src = "https://webservice.recruit.co.jp/banner/hotpepper-s.gif";
  image.width = 135; image.height = 17; image.alt = "ホットペッパーグルメ Webサービス"; image.title = "ホットペッパーグルメ Webサービス";
  link.append(image);
  return link;
}

function appendWeather(
  container: HTMLElement,
  weather: ViewerAgentExternalResponse["external"]["weather"],
): void {
  if (weather?.status !== "available" || !weather.data) return;
  const group = document.createElement("div");
  group.className = "external-weather";
  const heading = document.createElement("strong");
  heading.textContent = `${weather.data.locationName}の予報`;
  const days = document.createElement("div");
  days.className = "external-weather-days";
  for (const day of weather.data.daily.slice(0, 7)) {
    const card = document.createElement("article");
    const date = document.createElement("time");
    date.textContent = day.date.slice(5).replace("-", "/");
    const temperature = document.createElement("strong");
    temperature.textContent = `${Math.round(day.minimumTemperatureCelsius)}° / ${Math.round(day.maximumTemperatureCelsius)}°`;
    const precipitation = document.createElement("span");
    precipitation.textContent = `降水 ${Math.round(day.maximumPrecipitationProbabilityPercent)}%`;
    card.append(date, temperature, precipitation);
    days.append(card);
  }
  group.append(heading, days);
  group.append(evidenceCaption(weather));
  container.append(group);
}

function evidenceCaption(
  information: Pick<ExternalTravelInformation<unknown>, "evidence">,
): HTMLElement {
  const caption = document.createElement("small");
  caption.className = "external-evidence-caption";
  const evidence = information.evidence[0];
  caption.textContent = evidence
    ? `${evidence.attribution ?? evidence.provider}　取得 ${new Date(evidence.retrievedAt).toLocaleString("ja-JP")}`
    : "情報源を確認できません";
  return caption;
}
