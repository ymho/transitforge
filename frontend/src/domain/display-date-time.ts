import { operatingDayStartMinutes } from "./playback";
import { dateFromJapanDateTime, japanDateTimeParts } from "./japan-time";

export type DisplayDateTimeUnit = "month" | "day" | "hour" | "minute" | "second";

export interface DisplayDateTimeLabels {
  date: string;
  time: string;
}

const japaneseWeekdays = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function displayDateTimeLabels(date: Date): DisplayDateTimeLabels {
  const { year, month, day, hour, minute, second, weekday } = japanDateTimeParts(date);
  return {
    date: `${year}年${month}月${day}日(${japaneseWeekdays[weekday]})`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  };
}

export function stepDisplayDateTime(
  date: Date,
  unit: DisplayDateTimeUnit,
  amount: number,
): Date {
  const next = new Date(date);

  if (unit === "month") {
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + amount);
    next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
  } else if (unit === "day") {
    next.setDate(next.getDate() + amount);
  } else if (unit === "hour") {
    next.setHours(next.getHours() + amount);
  } else if (unit === "minute") {
    next.setMinutes(next.getMinutes() + amount);
  } else {
    next.setSeconds(next.getSeconds() + amount);
  }

  return next;
}

export function operatingServiceDateStart(date: Date): Date {
  const japan = japanDateTimeParts(date);
  const utcCalendar = new Date(Date.UTC(japan.year, japan.month - 1, japan.day));
  if (japan.hour * 60 + japan.minute < operatingDayStartMinutes) utcCalendar.setUTCDate(utcCalendar.getUTCDate() - 1);
  return dateFromJapanDateTime({
    year: utcCalendar.getUTCFullYear(), month: utcCalendar.getUTCMonth() + 1, day: utcCalendar.getUTCDate(),
    hour: 0, minute: 0, second: 0,
  });
}

export function dateForOperatingRouteTime(
  serviceDateStart: Date,
  routeTimeMinutes: number,
): Date {
  const date = new Date(serviceDateStart);
  date.setTime(date.getTime() + routeTimeMinutes * 60_000);
  return date;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
