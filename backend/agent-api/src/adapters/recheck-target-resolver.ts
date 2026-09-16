import { createHash } from "node:crypto";
import { projectTripPlaces } from "@raiquora/trip/trip-places";
import { samePlaceIdentity, validatePlaceSnapshot, type PlaceSnapshot } from "@raiquora/trip/place-snapshot";
import { monitoringKey, type TripWatch, type ResolvedWatchScope } from "@raiquora/trip/trip-watch";
import type { Trip } from "@raiquora/trip/trip";
import type { WeatherEventTarget } from "@raiquora/trip/weather-travel-event";
import { RecheckFailure } from "../contracts/trip-recheck.js";
import type { RecheckScopeResolver } from "../ports/trip-recheck.js";
import type { RecheckTargetCatalog } from "../ports/recheck-targets.js";

function verifiedCoordinate(place: PlaceSnapshot): boolean {
  validatePlaceSnapshot(place);
  return !!place.coordinate && !!place.timeZone && !!place.capturedAt && place.ref?.provider !== "manual" &&
    place.sources.some((source) => source.confidence !== "unknown" && ["place", "timetable", "accommodation", "restaurant"].includes(source.kind));
}
export function weatherPlaceSubject(place: PlaceSnapshot): string | undefined {
  if (!verifiedCoordinate(place)) return undefined;
  return `coordinate-v1:${createHash("sha256").update(monitoringKey([place.coordinate, place.timeZone])).digest("hex")}`;
}
/** Only saved coordinates with durable provenance; hazard area uses explicit identity catalog, never Place.area/title. */
export class TrustedRecheckTargetResolver implements RecheckScopeResolver {
  constructor(private readonly catalog: RecheckTargetCatalog) {}
  async resolve(trip: Trip): Promise<{ scopes: ResolvedWatchScope[]; unresolved: boolean }> {
    const scopes: ResolvedWatchScope[] = [];
    let unresolved = false;
    const bindings = await this.catalog.read(); // IO failure must not deactivate an already-resolved hazard Watch.
    for (const { itemId, place } of projectTripPlaces(trip).visitedPlaces) {
      const area = weatherPlaceSubject(place);
      if (area) scopes.push({ itineraryItemId: itemId, subject: { type: "weather-area", area } });
      else unresolved = true;
      const hazards = bindings.filter((binding) => samePlaceIdentity(binding.ref, place.ref));
      if (hazards.length === 1) scopes.push({ itineraryItemId: itemId, subject: { type: "hazard-area", area: hazards[0]!.area } });
      else unresolved = true;
    }
    return { scopes: [...new Map(scopes.map((scope) => [monitoringKey(scope), scope])).values()], unresolved };
  }
  weather(trip: Trip, watch: TripWatch): Pick<WeatherEventTarget, "subject" | "location" | "timezone"> {
    if (watch.subject.type !== "weather-area") throw new RecheckFailure("target_unknown");
    const area = watch.subject.area;
    const places = projectTripPlaces(trip).visitedPlaces.filter((entry) => entry.itemId === watch.itineraryItemId && weatherPlaceSubject(entry.place) === area);
    const values = [...new Map(places.map(({ place }) => [monitoringKey([place.coordinate, place.timeZone]), place])).values()];
    if (values.length !== 1) throw new RecheckFailure("target_unknown");
    const place = values[0]!;
    return { subject: { type: "weather-area", area },
      // Label is informational and comes from the saved place, not geocoding or name-based area inference.
      location: { name: place.name, longitude: place.coordinate!.longitude, latitude: place.coordinate!.latitude }, timezone: place.timeZone! };
  }
  async hazard(trip: Trip, watch: TripWatch) {
    if (watch.subject.type !== "hazard-area") throw new RecheckFailure("target_unknown");
    const area = watch.subject.area, scopes = await this.resolve(trip);
    if (!scopes.scopes.some((s) => s.itineraryItemId === watch.itineraryItemId && s.subject.type === "hazard-area" && s.subject.area === area)) throw new RecheckFailure("target_unknown");
    return { area, limit: 12 };
  }
}
