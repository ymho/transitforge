import { operatingDayStartMinutes } from "./playback";

export type DisplayDateTimeUnit = "month" | "day" | "hour" | "minute" | "second";

export interface DisplayDateTimeLabels {
  date: string;
  time: string;
}

const japaneseWeekdays = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function displayDateTimeLabels(date: Date): DisplayDateTimeLabels {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return {
    date: `${date.getFullYear()}年${month}月${day}日(${japaneseWeekdays[date.getDay()]})`,
    time: `${hour}:${minute}:${second}`,
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
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  if (date.getHours() * 60 + date.getMinutes() < operatingDayStartMinutes) {
    start.setDate(start.getDate() - 1);
  }
  return start;
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
