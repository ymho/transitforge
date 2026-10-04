import { projectPublicJourneyPresentation, type PublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { createHash } from "node:crypto";
import { scheduledSearchServices } from "@raiquora/journey/journey-search-engine";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import { selectRailJourney, projectRailSchedule, type RailTimetableInput } from "@raiquora/trip/selected-rail-journey";
import type { ItineraryItem } from "@raiquora/trip/trip";

/** Decode the SAME immutable normalized input used by search. Realtime-adjusted
 * display times never become the adopted scheduled itinerary. No model data. */
export function verifiedJourneySelectionItems(result: JourneySearchResponse, index: Record<string, unknown>, retrievedAt: string): ItineraryItem[] {
  if (index.service_date !== result.serviceDate) throw new Error("Selection timetable date mismatch");
  const decoded = scheduledSearchServices(index);
  const contentDigest = createHash("sha256").update(JSON.stringify(index)).digest("hex");
  const sourceId = `${index.schema_version}:${result.serviceDate}`;
  const input: RailTimetableInput = { sourceId, contentDigest,
    evidence: { id: `timetable:${contentDigest}`, kind: "timetable", provider: "transitforge", sourceId, retrievedAt, confidence: "provider-schedule" },
    defaultTransferMinutes: decoded.defaultTransferMinutes, stationTransferMinutes: decoded.stationTransferMinutes,
    index: { schema_version: "train-index-v1", path_catalog: "", service_date: result.serviceDate,
      trains: decoded.services.map(service => ({ service_uid: service.serviceUid, train_no: service.trainNumber,
        service_type: service.serviceType, train_name: service.trainName, origin_station: service.originStation, destination_station: service.destinationStation,
        stops: service.calls.flatMap(call => [
          ...(call.arrivalTimeMinutes === undefined ? [] : [{ station_name: call.stationName, event: "着", route_time_minutes: call.arrivalTimeMinutes }]),
          ...(call.departureTimeMinutes === undefined ? [] : [{ station_name: call.stationName, event: "発", route_time_minutes: call.departureTimeMinutes }]),
        ]) })) } };
  return result.journeys.slice(0, 3).map((journey, index) => {
    const id = `journey-${index + 1}`;
    const snapshot = selectRailJourney({ candidateId: id, verifiedJourneyRef: `${contentDigest}:${id}`, verifiedAt: retrievedAt,
      journey, transferPace: result.transferPace ?? "standard", legReferences: journey.legs.map(leg => {
        const trains = input.index.trains.filter(train => train.service_uid === leg.serviceUid);
        if (trains.length !== 1) throw new Error("Missing scheduled service");
        const stops = trains[0]!.stops;
        const matches = (station: string, event: string, minutes: number) => stops.flatMap((stop, i) =>
          stop.station_name === station && stop.event === event && stop.route_time_minutes === minutes ? [i] : []);
        const from = matches(leg.originStation, "発", leg.scheduledDepartureTimeMinutes), to = matches(leg.destinationStation, "着", leg.scheduledArrivalTimeMinutes);
        if (from.length !== 1 || to.length !== 1) throw new Error("Ambiguous scheduled stops");
        return { sourceId, contentDigest, serviceDate: result.serviceDate, originStopIndex: from[0]!, destinationStopIndex: to[0]! };
      }) }, [input], retrievedAt);
    return { id, title: `経路${index + 1}: ${result.originStation}→${result.destinationStation}`, type: "transport", schedule: projectRailSchedule(snapshot),
      detail: { status: "selected", mode: "rail", journey: snapshot } };
  });
}

/** Invocation-local association uses the complete shown leg snapshot, never route
 * names or ordinals alone. Conflicting provenance for identical display is refused. */
export class VerifiedJourneySelections {
  private readonly entries = new Map<string, ItineraryItem | null>();
  record(result: JourneySearchResponse, index: Record<string, unknown>, retrievedAt: string): void {
    const items = verifiedJourneySelectionItems(result, index, retrievedAt);
    const presentation = projectPublicJourneyPresentation(result);
    for (const journey of presentation?.journeys ?? []) {
      const item = items.find(item => item.id === journey.id)!;
      const key = this.key(presentation!, journey);
      const previous = this.entries.get(key);
      const provenance = (value: ItineraryItem) => value.type === "transport" && value.detail.status === "selected" && value.detail.mode === "rail"
        ? JSON.stringify([value.detail.journey.provenance.timetableInputs, value.detail.journey.provenance.transferPace]) : undefined;
      if (previous === null || previous && provenance(previous) !== provenance(item)) this.entries.set(key, null);
      else this.entries.set(key, structuredClone(item));
    }
  }
  itemsFor(presentation: PublicJourneyPresentation | undefined): ItineraryItem[] {
    return presentation?.journeys.flatMap((journey, index) => {
      const item = this.entries.get(this.key(presentation, journey));
      return item ? [{ ...structuredClone(item), title: `経路${index + 1}: ${presentation.originStation}→${presentation.destinationStation}` }] : [];
    }) ?? [];
  }
  private key(presentation: PublicJourneyPresentation, journey: PublicJourneyPresentation["journeys"][number]): string {
    return JSON.stringify([presentation.serviceDate, presentation.originStation, presentation.destinationStation, journey]);
  }
}
