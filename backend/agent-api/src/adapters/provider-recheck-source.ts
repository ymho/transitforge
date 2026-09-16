import type { Trip } from "@raiquora/trip/trip";
import type { TripWatch } from "@raiquora/trip/trip-watch";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import { recheckForecastRanges } from "@raiquora/trip/trip-recheck";
import { weatherTravelEvent } from "@raiquora/trip/weather-travel-event";
import { hazardTravelEvent } from "@raiquora/trip/travel-event-projection";
import type { HazardAlertProvider } from "@raiquora/trip/hazard-alert";
import { RecheckFailure } from "../contracts/trip-recheck.js";
import type { RecheckEventSource } from "../ports/trip-recheck.js";
import type { OpenMeteoWeatherProvider } from "./open-meteo-weather-provider.js";
import type { TrustedRecheckTargetResolver } from "./recheck-target-resolver.js";
import type { CollectorRecheckSource } from "./collector-recheck-source.js";

export class ProviderRecheckSource implements RecheckEventSource {
  constructor(private readonly targets: TrustedRecheckTargetResolver, private readonly weather: Pick<OpenMeteoWeatherProvider, "searchTarget">,
    private readonly hazard: HazardAlertProvider, private readonly rail: Pick<CollectorRecheckSource, "event">,
    private readonly now: () => Date = () => new Date()) {}
  async events(trip: Trip, watch: TripWatch, now: number) {
    if (watch.subject.type === "rail-service") return [await this.rail.event(watch.subject, now)];
    if (watch.subject.type === "hazard-area") {
      const query = await this.targets.hazard(trip, watch);
      const result = await this.hazard.search(query); available(result);
      return [hazardTravelEvent(query, result, this.now().toISOString())];
    }
    const target = this.targets.weather(trip, watch);
    const ranges = recheckForecastRanges(watch.activeWindow, target.timezone, now);
    if (!ranges.length) throw new RecheckFailure(watch.activeWindow.type === "unscheduled" ? "schedule_unknown" : "horizon");
    const events = [];
    for (const range of ranges) {
      const scoped = { ...target, query: { location: target.subject.area, ...range } };
      const result = await this.weather.searchTarget(scoped); available(result);
      events.push(weatherTravelEvent(scoped, result, this.now().toISOString()));
    }
    return events;
  }
}
function available<T>(result: ExternalTravelInformation<T>): void {
  if (result.status === "available") return;
  const code = result.failure?.code;
  throw new RecheckFailure(code === "timeout" || code === "rate_limited" || code === "invalid_response" ? code : "unavailable");
}
