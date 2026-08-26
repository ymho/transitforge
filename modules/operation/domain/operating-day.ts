export const operatingDayStartHourJst = 4;
const serviceDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

export function isValidServiceDate(value: string): boolean {
  if (!serviceDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function nextServiceDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function isInOperatingDay(collectedAt: string, serviceDate: string): boolean {
  const instant = Date.parse(collectedAt);
  if (Number.isNaN(instant) || !hasTimezone(collectedAt)) return false;
  const start = Date.parse(`${serviceDate}T${String(operatingDayStartHourJst).padStart(2, "0")}:00:00+09:00`);
  return instant >= start && instant < start + 24 * 60 * 60 * 1_000;
}

export function hourInJst(timestamp: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Number(parts.find(({ type }) => type === "hour")?.value ?? 0);
}

function hasTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
}
