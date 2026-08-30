export type LightPreset = "dawn" | "day" | "dusk" | "night";

export function lightPresetForRouteTime(
  routeTimeMinutes: number,
): LightPreset {
  const minutesPerDay = 24 * 60;
  const timeOfDay = ((routeTimeMinutes % minutesPerDay) + minutesPerDay) % minutesPerDay;

  if (timeOfDay < 5 * 60 || timeOfDay >= 20 * 60) {
    return "night";
  }
  if (timeOfDay < 8 * 60) {
    return "dawn";
  }
  if (timeOfDay < 16 * 60) {
    return "day";
  }
  return "dusk";
}
