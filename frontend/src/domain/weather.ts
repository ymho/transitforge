export type WeatherMode = "clear" | "cloudy" | "rain" | "snow";

export function isWeatherMode(value: string | undefined): value is WeatherMode {
  return (
    value === "clear" ||
    value === "cloudy" ||
    value === "rain" ||
    value === "snow"
  );
}
