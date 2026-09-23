import type { UserProfile } from "@raiquora/trip/travel-profile";
import { travelPreferenceLabels } from "@raiquora/trip/travel-profile";
import { validateTrip, type Trip, type ItineraryItem } from "@raiquora/trip/trip";
import type { ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import type { TripRequest } from "@raiquora/trip/trip-request";
import type { PlanningState, LifecycleState } from "@raiquora/trip/trip-state";
import { agentTripPlaces, type AgentTripPlaces } from "./agent-trip-places";
import { projectDailyItinerary, type DailyItineraryProjection } from "@raiquora/trip/daily-itinerary";
import { projectTripStructure, type TripStructureProjection } from "@raiquora/trip/trip-structure";
import { measureTripWorkload, type TripWorkload } from "@raiquora/trip/trip-workload";

export interface AgentContextSnapshot {
  /** Added by the read application only for lifecycle=in_trip, never persisted with Trip. */
  inTrip?: import("@raiquora/trip/in-trip-context").InTripContextSnapshot;
  travelCandidates?: Record<string, unknown>[];
  realtimeFacts?: Record<string, unknown>[];
  profile?: {
    home?: { station?: string; area?: string; carAvailable?: boolean };
    companions: string[];
    childAgeGroups: string[];
    favoriteInterests: string[];
    pace?: "relaxed" | "balanced" | "active";
    usualPartySizeHint?: number;
    preferredTransportHint?: UserProfile["transport"]["preferredMode"];
    /** Untrusted preference data, explicit opt-in only; never persisted in Trace. */
    consentedPreferenceNotes?: Partial<Record<"budget" | "lodging" | "food" | "avoidances", string>>;
    typicalTravelMinutes?: number;
    avoidances: string[];
  };
  trip?: {
    /** V2 projections only; neither a repository nor writable AgentDecision state. */
    tripId: string;
    sourceRevision: number;
    request?: TripRequest;
    planningState?: PlanningState;
    lifecycleState?: LifecycleState;
    scheduleTruncated?: boolean;
    totalItemCount: number;
    omittedItemCount: number;
    title: string;
    summaryDestination?: string;
    itineraryPlaces?: AgentTripPlaces["itineraryPlaces"];
    placesTruncated?: boolean;
    placeSemantics?: string;
    adults?: number;
    children?: number;
    considerations: string[];
    schedule: AgentTripScheduleItem[];
    dailyItinerary?: DailyItineraryProjection;
    tripStructure?: TripStructureProjection;
    workload?: TripWorkload;
  };
}

export interface AgentTripScheduleItem {
  observedPrice?: import("@raiquora/trip/money").PriceObservation;
  priceSemantics?: "retained-selection-observation-not-current-price";
  /** Stable Trip reference for item-scoped constraints and assumption effects. */
  itemId?: string;
  /** Trip preserves precision/flexibility and never infers a fixed time. */
  schedule?: ItinerarySchedule;
  type: "transport" | "stay" | "activity";
  category?: import("@raiquora/trip/trip").ActivityCategory;
  placeName?: string;
  area?: string;
  selectionStatus?: "selected" | "unresolved" | "unselected";
  mode?: import("@raiquora/trip/transport-detail").TransportMode;
  origin?: string;
  destination?: string;
  provenanceType?: "manual" | "provider" | "verified_timetable";
  originIsProvisional?: boolean;
  summary: string;
  date?: string;
  departureTimeMinutes?: number;
  arrivalTimeMinutes?: number;
}

const companionLabels: Record<string, string> = {
  solo: "一人",
  partner: "パートナー",
  friends: "友人",
  children: "子ども",
  family: "家族",
};

const childAgeLabels: Record<string, string> = {
  baby: "0〜2歳",
  preschool: "3〜5歳",
  elementary: "小学生",
  teen: "中学生以上",
};

export function createAgentContextSnapshot(
  profile?: UserProfile,
  trip?: Trip,
): AgentContextSnapshot {
  return {
    ...(profile ? { profile: profileSnapshot(profile) } : {}),
    ...(trip ? { trip: selectedTripSnapshot(trip) } : {}),
  };
}

function profileSnapshot(profile: UserProfile): NonNullable<AgentContextSnapshot["profile"]> {
  const partial = profile as Partial<UserProfile>;
  const travelStyle = partial.travelStyle as Partial<UserProfile["travelStyle"]> | undefined;
  const favoriteInterests = Object.entries(partial.preferences ?? {})
    .filter(([, weight]) => weight >= 0.7)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([key]) => travelPreferenceLabels[key as keyof typeof travelPreferenceLabels]);
  const avoidances = [
    [travelStyle?.crowdTolerance, "混雑"],
    [travelStyle?.walkingTolerance, "長時間歩行"],
    [travelStyle?.transferTolerance, "乗換が多い移動"],
    [travelStyle?.earlyMorningTolerance, "早朝出発"],
    [travelStyle?.lateNightTolerance, "夜遅い到着"],
    [travelStyle?.drivingTolerance, "車の運転"],
    [travelStyle?.busTolerance, "バス移動"],
  ] satisfies Array<[number | undefined, string]>;
  const homeProfile = partial.home;
  const home = {
    ...(bounded(homeProfile?.station, 80) ? { station: bounded(homeProfile?.station, 80) } : {}),
    ...(bounded(homeProfile?.area, 80) ? { area: bounded(homeProfile?.area, 80) } : {}),
    ...(homeProfile?.carAvailable === undefined ? {} : { carAvailable: homeProfile.carAvailable }),
  };
  const pace = travelStyle?.pace;
  const maximumTravelMinutes = partial.transport?.maxTypicalTravelMinutes;
  const consentedPreferenceNotes = Object.fromEntries((["budget", "lodging", "food", "avoidances"] as const)
    .filter((key) => partial.aiNoteFields?.includes(key) && bounded(partial.notes?.[key], 240))
    .map((key) => [key, bounded(partial.notes?.[key], 240)!]));
  return {
    ...(Object.keys(consentedPreferenceNotes).length ? { consentedPreferenceNotes } : {}),
    ...(home.station || home.area || home.carAvailable !== undefined ? { home } : {}),
    companions: partial.companions?.usual?.slice(0, 5).map((value) => companionLabels[value] ?? value) ?? [],
    childAgeGroups: partial.companions?.children?.slice(0, 6)
      .map(({ ageGroup }) => childAgeLabels[ageGroup] ?? ageGroup) ?? [],
    favoriteInterests,
    ...(pace === undefined ? {} : { pace: pace <= 0.35
      ? "relaxed"
      : pace >= 0.7 ? "active" : "balanced" }),
    ...(partial.companions?.usualPartySize === undefined ? {} : { usualPartySizeHint: partial.companions.usualPartySize }),
    ...(partial.transport?.preferredMode === undefined ? {} : { preferredTransportHint: partial.transport.preferredMode }),
    ...(maximumTravelMinutes === null || maximumTravelMinutes === undefined
      ? {}
      : { typicalTravelMinutes: Math.max(0, Math.min(1_440, Math.round(maximumTravelMinutes))) }),
    avoidances: avoidances.filter(([tolerance]) => tolerance !== undefined && tolerance <= 0.35)
      .map(([, label]) => label),
  };
}

function selectedTripSnapshot(trip: Trip): NonNullable<AgentContextSnapshot["trip"]> {
  validateTrip(trip);
  const dailyItinerary = projectDailyItinerary(trip, { limit: 6 });
  return { tripId: trip.id, sourceRevision: trip.revision,
    title: bounded(trip.title, 100) ?? "現在の旅程", considerations: [],
    ...(trip.summaryDestination === undefined ? {} : { summaryDestination: trip.summaryDestination }),
    ...agentTripPlaces(trip),
    request: structuredClone(trip.request),
    planningState: trip.planningState, lifecycleState: trip.lifecycleState,
    dailyItinerary, tripStructure: projectTripStructure(trip), workload: measureTripWorkload(trip, dailyItinerary),
    scheduleTruncated: trip.items.length > 24,
    totalItemCount: trip.items.length,
    omittedItemCount: Math.max(0, trip.items.length - 24),
    schedule: trip.items.slice(0, 24).map(selectedTripItemSnapshot) };
}

/** Same allowlisted item projection for the full itinerary and ephemeral focused-item context. */
export function selectedTripItemSnapshot(item: ItineraryItem): AgentTripScheduleItem {
      const schedule = structuredClone(item.schedule);
      if (item.type === "activity") return { itemId: item.id, type: "activity", schedule,
        category: item.category, summary: bounded(item.title, 100)!,
        ...(item.place ? { placeName: bounded(item.place.name, 100) } : {}) };
      if (item.type === "stay") {
        const place = item.selection.status === "selected" ? item.selection.accommodation.place : item.selection.place;
        return { itemId: item.id, type: "stay", schedule, selectionStatus: item.selection.status,
          ...(item.selection.status === "selected" && item.selection.accommodation.observedPrice ? {
            observedPrice: structuredClone(item.selection.accommodation.observedPrice),
            priceSemantics: "retained-selection-observation-not-current-price",
          } : {}),
          summary: bounded(place?.name ?? item.title, 100) ?? "宿泊",
          ...(place ? { placeName: bounded(place.name, 100), area: bounded(place.area, 100) } : {}) };
      }
      if (item.detail.status === "unresolved") return { itemId: item.id, type: "transport", schedule, mode: item.detail.mode, summary: bounded(item.title, 100) ?? "移動", selectionStatus: "unresolved" };
      if (item.detail.mode !== "rail") return { itemId: item.id, type: "transport", schedule, mode: item.detail.mode,
        origin: item.detail.origin.name, destination: item.detail.destination.name, provenanceType: item.detail.provenance.type,
        selectionStatus: "selected", summary: bounded(item.title, 100) ?? "移動" };
      const journey = item.detail.journey;
      return { itemId: item.id, type: "transport", schedule, selectionStatus: "selected", mode: "rail", provenanceType: "verified_timetable",
        origin: journey.legs[0]!.origin.name, destination: journey.legs.at(-1)!.destination.name,
        summary: `${bounded(journey.legs[0]!.origin.name, 80)}→${bounded(journey.legs.at(-1)!.destination.name, 80)}（計画 ${journey.legs[0]!.scheduledDeparture.at} → ${journey.legs.at(-1)!.scheduledArrival.at}）`,
        date: journey.serviceDate };
}

function bounded(value: string | undefined, maximum: number): string | undefined {
  const normalized = value?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maximum) : undefined;
}
