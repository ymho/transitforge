export const japanTimeZone = "Asia/Tokyo";

export interface JapanDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export function japanDateTimeParts(value: Date): JapanDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: japanTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(value);
  const byType = new Map(parts.map(({ type, value: part }) => [type, part]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(byType.get("weekday") ?? "");
  return {
    year: Number(byType.get("year")), month: Number(byType.get("month")), day: Number(byType.get("day")),
    hour: Number(byType.get("hour")), minute: Number(byType.get("minute")), second: Number(byType.get("second")),
    weekday,
  };
}

export function dateFromJapanDateTime(parts: Omit<JapanDateTimeParts, "weekday">): Date {
  const pad = (value: number) => String(value).padStart(2, "0");
  return new Date(`${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}+09:00`);
}

export function japanCalendarDate(value: Date): string {
  const { year, month, day } = japanDateTimeParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
