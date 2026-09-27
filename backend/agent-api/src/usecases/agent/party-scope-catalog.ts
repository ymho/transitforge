import type { Trip } from "@raiquora/trip/trip";
import { projectTripStructure } from "@raiquora/trip/trip-structure";
import type { PartyScopeCatalog } from "@raiquora/trip/party-cohorts";

/** Called only after owner-scoped Trip loading. Labels help selection, not identity. */
export function partyScopeCatalog(trip: Trip): PartyScopeCatalog {
  const structure = projectTripStructure(trip);
  return { tripId: trip.id, tripRevision: trip.revision,
    days: (trip.timeline?.logicalDays ?? []).map((day, index) => ({ id: day.id, label: day.label ?? `${index + 1}日目` })),
    segments: structure.segments.filter(segment => segment.kind !== "unresolved").slice(0, 180).map(segment => ({
      id: segment.segmentId,
      label: segment.sourceItemIds.map(id => trip.items.find(item => item.id === id)?.title ?? "区間").join(" / "),
    })),
  };
}
