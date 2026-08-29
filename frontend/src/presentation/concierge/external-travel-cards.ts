import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { WeatherForecast } from "@raiquora/trip/weather-forecast";
import type { ViewerAgentExternalResponse } from "../../domain/viewer-agent-response";

export function renderExternalTravelInformation(
  response: ViewerAgentExternalResponse,
  onWeather?: (forecast: WeatherForecast) => void,
): HTMLElement {
  const container = document.createElement("section");
  container.className = "external-travel-cards";
  appendWeather(container, response.external.weather, onWeather);
  appendFlights(container, response.external.flights);
  return container;
}

function appendWeather(
  container: HTMLElement,
  weather: ViewerAgentExternalResponse["external"]["weather"],
  onWeather?: (forecast: WeatherForecast) => void,
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
  if (onWeather) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "external-weather-map-action";
    action.textContent = "この天気を地図へ反映";
    action.addEventListener("click", () => onWeather(weather.data!));
    group.append(action);
  }
  group.append(evidenceCaption(weather));
  container.append(group);
}

function appendFlights(
  container: HTMLElement,
  flights: ViewerAgentExternalResponse["external"]["flights"],
): void {
  if (flights?.status !== "available" || !flights.data) return;
  const list = document.createElement("div");
  list.className = "external-flight-list";
  for (const offer of flights.data.offers.slice(0, 5)) {
    const card = document.createElement("article");
    const first = offer.segments[0];
    const last = offer.segments.at(-1);
    card.textContent = first && last
      ? `${first.departureAt.slice(11, 16)} ${first.departureAirportCode} → ${last.arrivalAt.slice(11, 16)} ${last.arrivalAirportCode}　${offer.nonStop ? "直行" : `乗継${offer.segments.length - 1}回`}`
      : "航空便";
    list.append(card);
  }
  list.append(evidenceCaption(flights));
  container.append(list);
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
