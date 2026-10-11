/** Retrieval timestamp of cited material, not a live business status. */
export function researchDateLabel(retrievedAt: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" })
    .format(new Date(retrievedAt));
}

export function researchTimestampLabel(at: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const value = (key: string) => parts.find(part => part.type === key)?.value;
  return `${value("year")}/${value("month")}/${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
}
