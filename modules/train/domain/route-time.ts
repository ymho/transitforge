const minutesPerDay = 24 * 60;

/** 24時超の業務時刻を0〜23時台の時計時刻へ変換する。 */
export function routeClockMinutes(routeTimeMinutes: number): number {
  const roundedMinutes = Math.round(routeTimeMinutes);
  return ((roundedMinutes % minutesPerDay) + minutesPerDay) % minutesPerDay;
}

/** 24時超を翌日の時計へ折り返してHH:mmで表示する。 */
export function formatRouteClockTime(routeTimeMinutes: number): string {
  return formatHourMinute(routeClockMinutes(routeTimeMinutes));
}

/** 24時超を保った業務時刻をHH:mmで表示する。 */
export function formatServiceTime(routeTimeMinutes: number): string {
  return formatHourMinute(Math.round(routeTimeMinutes));
}

/** 24時超を翌日の時計へ折り返して日本語で表示する。 */
export function formatJapaneseRouteClockTime(routeTimeMinutes: number): string {
  const clockMinutes = routeClockMinutes(routeTimeMinutes);
  return `${Math.floor(clockMinutes / 60)}時${String(clockMinutes % 60).padStart(2, "0")}分`;
}

/** 24時超と小数分を保った業務時刻を日本語で表示する。 */
export function formatJapaneseServiceTime(routeTimeMinutes: number): string {
  const totalSeconds = Math.round(routeTimeMinutes * 60);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const base = `${hours}時${String(minutes).padStart(2, "0")}分`;
  return seconds === 0 ? base : `${base}${String(seconds).padStart(2, "0")}秒`;
}

function formatHourMinute(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
