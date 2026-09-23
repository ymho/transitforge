import { samePlaceIdentity, type PlaceSnapshot } from "./place-snapshot";
import { projectTripPlaces } from "./trip-places";
import { validateTrip, type Trip } from "./trip";
import type { TripRelationKind } from "./trip-structure-contract";

export type TravelSegmentKind = "stay-base" | "excursion" | "intercity" | "unresolved";
export interface TravelSegment {
  readonly segmentId: string;
  readonly kind: TravelSegmentKind;
  readonly sourceItemIds: readonly string[];
  readonly originRef?: PlaceSnapshot["ref"];
  readonly destinationRef?: PlaceSnapshot["ref"];
  readonly supportingObservationIds: readonly string[];
  readonly revision: number;
  readonly provenance: "derived" | "authored";
}
export interface TripRelation {
  readonly relationId: string;
  readonly beforeItemRef: string;
  readonly afterItemRef: string;
  readonly kind: TripRelationKind;
  readonly status: "observed" | "authored" | "assumed" | "unknown";
  readonly evidenceRefs: readonly string[];
  readonly revision: number;
}
export interface TripStructureProjection {
  readonly version: 1;
  readonly sourceTripId: string;
  readonly sourceRevision: number;
  readonly segments: readonly TravelSegment[];
  readonly relations: readonly TripRelation[];
  readonly unresolvedItemIds: readonly string[];
}

/** Occurrence-based projection: names never establish identity or geography. */
export function projectTripStructure(trip: Trip): TripStructureProjection {
  validateTrip(trip);
  const places = projectTripPlaces(trip), segments: TravelSegment[] = [], unresolved = new Set<string>();
  for (const item of trip.items) {
    if (item.type === "stay") {
      if (item.selection.status !== "selected") { unresolved.add(item.id); segments.push(segment(trip, item.id, "unresolved", [item.id])); continue; }
      segments.push(segment(trip, item.id, "stay-base", [item.id], item.selection.accommodation.place, item.selection.accommodation.place));
      continue;
    }
    if (item.type !== "transport") continue;
    const endpoints = places.transportEndpoints.filter(({ itemId }) => itemId === item.id);
    if (!endpoints.length) { unresolved.add(item.id); segments.push(segment(trip, item.id, "unresolved", [item.id])); continue; }
    const first = endpoints[0]!, last = endpoints.at(-1)!;
    const kind: TravelSegmentKind = samePlaceIdentity(first.origin.ref, last.destination.ref) ? "excursion" : "intercity";
    segments.push(segment(trip, item.id, kind, [item.id], first.origin, last.destination));
  }
  const transportItems = trip.items.filter(({ type }) => type === "transport");
  for (let leftIndex = 0; leftIndex < transportItems.length; leftIndex++) {
    const outbound = transportItems[leftIndex]!, outboundEndpoints = places.transportEndpoints.filter(({ itemId }) => itemId === outbound.id);
    if (!outboundEndpoints.length) continue;
    for (const returning of transportItems.slice(leftIndex + 1)) {
      const returnEndpoints = places.transportEndpoints.filter(({ itemId }) => itemId === returning.id);
      if (!returnEndpoints.length) continue;
      const outStart = outboundEndpoints[0]!.origin, outEnd = outboundEndpoints.at(-1)!.destination;
      const backStart = returnEndpoints[0]!.origin, backEnd = returnEndpoints.at(-1)!.destination;
      if (samePlaceIdentity(outStart.ref, backEnd.ref) && samePlaceIdentity(outEnd.ref, backStart.ref)) {
        segments.push({ ...segment(trip, `${outbound.id}:${returning.id}`, "excursion", [outbound.id, returning.id], outStart, outEnd),
          segmentId: `derived:${outbound.id}:${returning.id}:excursion` });
        break;
      }
    }
  }
  for (const authored of trip.structureIntent?.authoredSegments ?? []) segments.push({ segmentId: authored.segmentId, kind: "stay-base",
    sourceItemIds: authored.anchorItemIds, supportingObservationIds: [], revision: trip.revision, provenance: "authored" });
  const relations: TripRelation[] = (trip.structureIntent?.relations ?? []).map((relation) => ({ ...relation,
    evidenceRefs: relation.evidenceRefs ?? [], revision: trip.revision }));
  for (const excursion of segments.filter(({ kind, sourceItemIds }) => kind === "excursion" && sourceItemIds.length === 2)) relations.push({
    relationId: `derived:${excursion.sourceItemIds[0]}:${excursion.sourceItemIds[1]}:return`, beforeItemRef: excursion.sourceItemIds[0]!,
    afterItemRef: excursion.sourceItemIds[1]!, kind: "return-to-base", status: "observed", evidenceRefs: [], revision: trip.revision,
  });
  for (let index = 1; index < trip.items.length; index++) {
    const before = trip.items[index - 1]!, after = trip.items[index]!;
    if (!relations.some((r) => r.beforeItemRef === before.id && r.afterItemRef === after.id)) relations.push({
      relationId: `derived:${before.id}:${after.id}:movement`, beforeItemRef: before.id, afterItemRef: after.id,
      kind: "requires-movement", status: endpointsKnown(before, after) ? "observed" : "unknown", evidenceRefs: [], revision: trip.revision,
    });
  }
  return structuredClone({ version: 1, sourceTripId: trip.id, sourceRevision: trip.revision, segments, relations, unresolvedItemIds: [...unresolved] });
}
function segment(trip: Trip, anchor: string, kind: TravelSegmentKind, sourceItemIds: string[], origin?: PlaceSnapshot, destination?: PlaceSnapshot): TravelSegment {
  return { segmentId: `derived:${anchor}:${kind}`, kind, sourceItemIds, ...(origin?.ref ? { originRef: origin.ref } : {}),
    ...(destination?.ref ? { destinationRef: destination.ref } : {}), supportingObservationIds: [], revision: trip.revision, provenance: "derived" };
}
function endpointsKnown(before: Trip["items"][number], after: Trip["items"][number]): boolean {
  const endpoint = (item: Trip["items"][number], end: boolean): PlaceSnapshot | undefined => item.type === "transport" && item.detail.status === "selected"
    ? item.detail.mode === "rail" ? (end ? item.detail.journey.legs.at(-1)?.destination : item.detail.journey.legs[0]?.origin) : (end ? item.detail.destination : item.detail.origin)
    : item.type === "stay" && item.selection.status === "selected" ? item.selection.accommodation.place : item.type === "activity" ? item.place : undefined;
  return endpoint(before, true) !== undefined && endpoint(after, false) !== undefined;
}
