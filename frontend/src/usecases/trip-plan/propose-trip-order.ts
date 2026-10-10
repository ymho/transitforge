import { applyTripProposal, type Trip, type TripUpdateProposal } from "@raiquora/trip/trip";

export function proposeTripOrder(trip: Trip, order: readonly string[]): TripUpdateProposal | undefined {
  if (order.length !== trip.items.length || new Set(order).size !== order.length ||
    order.some(id => !trip.items.some(item => item.id === id))) throw new Error("Invalid Trip order");
  if (order.every((id, index) => trip.items[index]!.id === id)) return undefined;
  const currentOrder = trip.items.map(item => item.id), patches: TripUpdateProposal["patches"][number][] = [];
  order.forEach((itemId, index) => {
    if (currentOrder[index] === itemId) return;
    patches.push({ type: "move", itemId, ...(index ? { afterId: order[index - 1]! } : {}) });
    currentOrder.splice(currentOrder.indexOf(itemId), 1); currentOrder.splice(index, 0, itemId);
  });
  const proposal: TripUpdateProposal = { tripId: trip.id, baseRevision: trip.revision, summary: "予定の順番を変更", patches };
  applyTripProposal(trip, proposal);
  return proposal;
}
