/** Title generation receives only current itinerary names, never sharing credentials or conversations. */
export interface TripTitleGenerator {
  generate(items: readonly { type: string; title: string }[]): Promise<string>;
}
