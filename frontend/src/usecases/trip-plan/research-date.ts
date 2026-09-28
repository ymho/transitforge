/** Retrieval timestamp of cited material, not a live business status. */
export function researchDateLabel(retrievedAt: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" })
    .format(new Date(retrievedAt));
}
