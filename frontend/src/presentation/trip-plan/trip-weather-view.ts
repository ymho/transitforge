import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import { currentTripWeather } from "@raiquora/trip/trip-weather";
import { element } from "./trip-workspace-elements";

export function renderTripWeather(trip: Trip, item: ItineraryItem, localDate?: string): HTMLElement | undefined {
  const saved = currentTripWeather(trip, item); if (!saved) return undefined;
  const root = element("section", "trip-item-weather"); root.setAttribute("aria-label", "予定の天気");
  for (const forecast of saved.forecasts) {
    const label = forecast.target.role === "departure" ? "出発" : forecast.target.role === "arrival" ? "到着" : "";
    const row = forecast.target.at ? forecast.rows[0] : forecast.rows.find(row => row.date === (localDate ?? forecast.target.startDate));
    const unavailable = forecast.status === "unavailable" ? "取得できません" : "予報期間外";
    const temperature = row ? row.temperatureCelsius !== undefined ? `${Math.round(row.temperatureCelsius)}℃` : `${Math.round(row.minimumTemperatureCelsius!)}〜${Math.round(row.maximumTemperatureCelsius!)}℃` : "";
    const text = row ? `${weatherLabel(row.weatherCode)} ${temperature}・降水${Math.round(row.precipitationProbabilityPercent)}%` : unavailable;
    const at = forecast.target.at ? forecast.target.at.at.slice(11, 16) : localDate ?? forecast.target.startDate;
    root.append(element("p", "", `${label ? `${label} ${forecast.target.place.name} ${at}　` : "天気　"}${text}`));
  }
  return root;
}
function weatherLabel(code: number): string {
  if (code === 0) return "☀ 晴れ";
  if (code === 1) return "☀ おおむね晴れ";
  if (code === 2) return "☁ 晴れ間あり";
  if (code === 3) return "☁ 曇り";
  if (code === 45 || code === 48) return "霧";
  if (code >= 95) return "⛈ 雷雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄ 雪";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "☂ 雨";
  return "天気不明";
}
