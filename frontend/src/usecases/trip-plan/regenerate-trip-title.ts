import type { ServerTripClient } from "./server-trip-client";
/** Generate from a fresh server snapshot and commit only against that same revision. */
export async function regenerateTripTitle(client: Pick<ServerTripClient, "get" | "generateTitle" | "mutate">, tripId: string) {
  const trip = await client.get(tripId);
  if (!trip || !client.generateTitle) throw new Error("Title generation unavailable");
  const title = await client.generateTitle(tripId, trip.revision);
  return client.mutate({ tripId, baseRevision: trip.revision, mutationId: crypto.randomUUID(),
    proposal: { tripId, baseRevision: trip.revision, summary: "旅のタイトルを再生成", patches: [{ type: "title", title }] } });
}
