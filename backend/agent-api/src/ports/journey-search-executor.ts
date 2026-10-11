import type { JourneySearchRequest, JourneySearchRuntimeInput } from "@raiquora/journey";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import type { ItineraryItem } from "@raiquora/trip/trip";
/** CPU execution boundary. Domain calculations remain deterministic and pure. */
export interface JourneySearchExecutor {
  execute(request: JourneySearchRequest, input: JourneySearchRuntimeInput, retrievedAt: string, signal?: AbortSignal): Promise<{ result: JourneySearchResponse & { trace: import("@raiquora/journey").JourneySearchTrace }; items: ItineraryItem[] }>;
}
