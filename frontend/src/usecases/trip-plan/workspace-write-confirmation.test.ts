import { expect, it, vi } from "vitest";
import { createTrip, applyTripProposal, type TripUpdateProposal } from "@raiquora/trip/trip";
import { validateWorkspaceWriteConfirmation } from "./workspace-write-confirmation";
import { createServerTripWorkspaceSource } from "./server-trip-workspace-source";
import { HttpServerTripClient } from "../../adapters/http/server-trip-client";

it("saves booking and memo through the real composition guard, HTTP contract and source refresh on old V2 trips", async () => {
 let trip = createTrip("11111111-1111-4111-8111-111111111111", "既存の旅", "2026-09-13T00:00:00Z",
  [{ id: "hotel", type: "stay", title: "宿", selection: { status: "unselected" }, schedule: { type: "day", date: "2026-10-12", timeZone: "Asia/Tokyo" } }]);
 const requests: string[] = [];
 const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
   const command = JSON.parse(init!.body as string); requests.push(command.operation);
   if (command.operation === "get") return new Response(JSON.stringify({ version: "trip-api-v1", trip, role: "owner" }));
   expect(command.baseRevision).toBe(trip.revision);
   trip = { ...applyTripProposal(trip, command.proposal), revision: trip.revision + 1 };
   return new Response(JSON.stringify({ version: "trip-api-v1", trip, revision: trip.revision, mutationId: command.mutationId }));
 });
 const client = new HttpServerTripClient("/api/trips/v1", fetcher);
 const source = createServerTripWorkspaceSource(trip.id, client, { mutate: request => client.mutate(request),
   newMutationId: () => crypto.randomUUID(), validateConfirmation: validateWorkspaceWriteConfirmation });
 await source.refresh();
 for (const patch of [{ type: "item_booking" as const, itemId: "hotel", status: "booked" as const },
   { type: "item_memo" as const, itemId: "hotel", memo: "集合場所\n改札前" }]) {
   await source.confirmProposal!({ tripId: trip.id, baseRevision: trip.revision, summary: "変更", patches: [patch] });
 }
 expect(source.getCurrentTrip()?.items[0]).toMatchObject({ bookingStatus: "booked", memo: "集合場所\n改札前" });
 expect(requests.filter(value => value === "mutate")).toHaveLength(2);
 const forbidden: TripUpdateProposal = { tripId: trip.id, baseRevision: trip.revision, summary: "変更", patches: [{ type: "remove", itemId: "hotel" }] };
 await expect(validateWorkspaceWriteConfirmation(trip, forbidden)).rejects.toThrow("確認が必要");
});
