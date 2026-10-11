/** Public HTTP shapes for OpenAPI generation. Runtime validators remain authoritative.
 * Reuse Domain types; never expose principals, repository records or internal Tool contracts.
 */
import type { Trip } from "@raiquora/trip/trip";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import type { OfficialGuide } from "@raiquora/trip/official-guide";
import type { ShareGrantView, TripParticipantView, SharedTripRole } from "@raiquora/trip/trip-sharing";
import type { ReservationFact } from "@raiquora/trip/reservation";
import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";
import type { BrowserAgentDiagnosticCommand } from "@raiquora/agent/browser-agent-diagnostic";
import type { ConversationTurnInput } from "../backend/agent-api/src/usecases/agent/conversation-turn.js";
import type { Conversation, ConversationMetadata, ConversationMessage, PageOptions, ProfileState } from "../backend/agent-api/src/contracts/server-state.js";
import type { TripApiCommand, PlanAdoptionApiCommand, TripAdoptionApiCommand, ItemDecisionApiCommand } from "../backend/agent-api/src/contracts/trip-api.js";
import type { SharingCommand } from "../backend/agent-api/src/contracts/trip-sharing-api.js";
import type { CandidateAdoptionResult } from "../backend/agent-api/src/ports/itinerary-candidate-repository.js";
import type { JourneySearchRequest, JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import type { WeatherForecast, WeatherForecastQuery } from "@raiquora/trip/weather-forecast";
import type { WeatherGridSnapshot, WeatherGridPoint } from "@raiquora/trip/weather-grid";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { PlaceMediaSearchResult } from "@raiquora/trip/place-media";
import type { PlaceRef } from "@raiquora/trip/place-snapshot";
import type { HazardAlertQuery, HazardAlertSearchResult } from "@raiquora/trip/hazard-alert";
import type { GroundAccessPoint, GroundAccessMode, GroundAccessRoute, GroundAccessMatrix, GroundAccessArea } from "@raiquora/trip/ground-access";
import type { RestaurantRequirements, RestaurantSearchResult } from "@raiquora/trip/restaurant-search";
import type { WebSearchResult, WebPageReadResult } from "@raiquora/trip/web-research";
import type { TravelProviderSearch } from "@raiquora/trip/travel-provider";
import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import type { JourneySearchTrace } from "@raiquora/journey/journey-search-engine";
import type { DailyCongestionAnalysisResponse, DailyCongestionPeakResponse, TrainDelayAnalysisResponse } from "@raiquora/operation/analysis";

type PublicConversation = Omit<Conversation, "ownerSubject">;
type ConversationCommand = { version: "conversation-api-v1" } & (
  | { operation: "create"; metadata: ConversationMetadata }
  | { operation: "get"; conversationId: string }
  | { operation: "list"; page?: PageOptions }
  | { operation: "history"; conversationId: string; page?: PageOptions }
  | { operation: "update"; conversationId: string; expectedRevision: number; metadata: ConversationMetadata }
  | { operation: "delete"; conversationId: string; expectedRevision: number });
type ConversationResponse = { version: "conversation-api-v1" } & (
  | { conversation: PublicConversation }
  | { items: PublicConversation[]; nextAfter?: string }
  | { items: ConversationMessage[]; nextAfter?: string }
  | { complete: boolean });
type ProfileCommand = { version: "profile-api-v1" } & (
  | { operation: "get" }
  | { operation: "update"; profile: UserProfile; expectedRevision: number | null }
  | { operation: "delete"; expectedRevision: number });
type ProfileResponse = { version: "profile-api-v1" } & (
  | { profile: ProfileState | null } | ProfileState | { ok: true });
type ConfirmationCommand<T extends { operation: string; confirmationKey?: string }> =
  Omit<T, "operation" | "confirmationKey"> & (
    | { operation: Extract<T["operation"], `preview-${string}`> }
    | { operation: Extract<T["operation"], `confirm-${string}`>; confirmationKey: string });
type TripCommand = TripApiCommand | ConfirmationCommand<PlanAdoptionApiCommand> |
  ConfirmationCommand<TripAdoptionApiCommand> | ConfirmationCommand<ItemDecisionApiCommand>;
type TripResponse = { version: "trip-api-v1" } & (
  | { trip: Trip; revision?: number; mutationId?: string; role?: "owner" | SharedTripRole; status?: "saved" }
  | { trip: Trip; conversationId: string; sourceTripId?: string }
  | { status: "out-of-scope"; message: string }
  | { trips: Trip[]; nextAfterTripId?: string }
  | { title: string; baseRevision: number }
  | { tripId?: string }
  | CandidateAdoptionResult
  | { status: "confirmation-required"; confirmationKey: string; preview: { action: "confirm" | "withdraw"; summary: string; needsReconfirmation: boolean } }
  | { status: "confirmation-required"; confirmationKey: string; preview: { itemId: string; title: string; action: "confirm" | "withdraw"; needsReconfirmation: boolean } });
type OfficialCommand = { version: "trip-sharing-v1" } & (
  | { operation: "official-capabilities" }
  | { operation: "official-list"; afterTripId?: string }
  | { operation: "official-get"; tripId: string }
  | { operation: "official-publish"; tripId: string; baseRevision: number }
  | { operation: "official-withdraw"; tripId: string; guideVersion: number }
  | { operation: "official-import"; tripId: string; guideVersion: number; newTripId: string; startDate: string; adults: number; children: number });
type SharingResponse = { version: "trip-sharing-v1" } & (
  | { grant: ShareGrantView; secret: string }
  | { tripId: string; role: "owner" | SharedTripRole }
  | { participants: TripParticipantView[]; grants: ShareGrantView[]; after?: string }
  | { trips: Array<{ trip: Trip; role: "owner" | SharedTripRole }>; afterTripId?: string }
  | { facts: ReservationFact[] }
  | { publisher: boolean }
  | { guides: OfficialGuide[]; after?: string }
  | { guide: OfficialGuide }
  | { trip: Trip }
  | { version: "trip-sharing-v1" });
type StreamCommand = Omit<ConversationTurnInput, "principal">;
type AgentEventFrame = { v: 1; runId: string; seq: number; event: AgentTurnEvent };
type DoneEventFrame = { v: 1; runId: string; seq: number };

type PlaceCommand = { query: string; latitude?: number; longitude?: number; radiusMeters?: number; limit?: number; detail?: boolean };
type ReadCommand =
  | ({ operation: "weather_forecast_search" } & WeatherForecastQuery)
  | { operation: "weather_grid_search"; points: WeatherGridPoint[]; targetTime?: string }
  | { operation: "representative_timetable_search"; timetableKind: "weekday" | "weekend_holiday"; query: string; mode: "active" | "arrivals" | "departures"; targetTimeMinutes?: number | null; limit?: number }
  | ({ operation: "journey_search"; contractVersion: "journey-search-v1"; includeTrace?: boolean } & JourneySearchRequest)
  | { operation: "daily_congestion_analysis" | "daily_congestion_peak" | "train_delay_analysis"; serviceDate: string }
  | ({ operation: "travel_accommodation_search" } & Omit<TravelProviderSearch, "adults" | "limit"> & { adults?: number; limit?: number })
  | ({ operation: "place_media_search" } & PlaceCommand)
  | ({ operation: "place_detail_research"; targetRef?: PlaceRef } & Pick<PlaceCommand, "query" | "latitude" | "longitude">)
  | { operation: "web_search"; query: string; freshness?: "day" | "week" | "month" | "year"; domains?: string[]; limit?: number }
  | { operation: "web_page_read"; urls: string[] }
  | ({ operation: "travel_alert_search" } & HazardAlertQuery)
  | { operation: "ground_access_search"; action: "route" | "matrix" | "isochrone"; mode: GroundAccessMode; origin: GroundAccessPoint; destinations?: GroundAccessPoint[]; minutes?: number }
  | { operation: "restaurant_search"; area: string; keyword?: string; latitude?: number; longitude?: number; range?: 1 | 2 | 3 | 4 | 5; requirements?: RestaurantRequirements; limit?: number };
type ReadResponse =
  | { forecast: ExternalTravelInformation<WeatherForecast> }
  | { weatherGrid: ExternalTravelInformation<WeatherGridSnapshot> }
  | { timetableKind: "weekday" | "weekend_holiday"; serviceDate: string; mode: "active" | "arrivals" | "departures"; targetTimeMinutes: number | null; totalMatchCount: number; matches: Array<{ trainNumber: string; serviceType: string; trainName: string; origin: string; destination: string; matchingStops: Array<{ stationName: string; event: string; routeTimeMinutes: number }> }> }
  | (JourneySearchResponse & { contractVersion: "journey-search-v1"; trace?: JourneySearchTrace; realtime: Record<string, unknown> })
  | DailyCongestionAnalysisResponse | DailyCongestionPeakResponse | TrainDelayAnalysisResponse
  | { accommodations: AccommodationOffering[] }
  | { result: ExternalTravelInformation<PlaceMediaSearchResult>; targetObservations?: Array<{ providerPlaceId: string; status: string; reason?: string }> }
  | { webSearch: ExternalTravelInformation<WebSearchResult> }
  | { webPages: ExternalTravelInformation<WebPageReadResult> }
  | { alerts: ExternalTravelInformation<HazardAlertSearchResult> }
  | { groundAccess: ExternalTravelInformation<GroundAccessRoute | GroundAccessMatrix | GroundAccessArea> }
  | { restaurants: ExternalTravelInformation<RestaurantSearchResult> };

/** Explicit roots prevent schema generation from publishing unrelated/internal types. */
export interface OpenApiModels {
  BrowserDiagnosticCommand: BrowserAgentDiagnosticCommand;
  BrowserDiagnosticResponse: { version: "browser-agent-diagnostics-v1"; ok: true };
  ConversationCommand: ConversationCommand;
  ConversationResponse: ConversationResponse;
  ProfileCommand: ProfileCommand;
  ProfileResponse: ProfileResponse;
  TripCommand: TripCommand;
  TripResponse: TripResponse;
  SharingCommand: SharingCommand | OfficialCommand;
  SharingResponse: SharingResponse;
  StreamCommand: StreamCommand;
  AgentEventFrame: AgentEventFrame;
  DoneEventFrame: DoneEventFrame;
  ReadCommand: ReadCommand;
  ReadResponse: ReadResponse;
}
