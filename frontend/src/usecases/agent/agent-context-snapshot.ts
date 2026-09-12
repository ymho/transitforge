import type { UserProfile } from "@raiquora/trip/travel-profile";
import { travelPreferenceLabels } from "@raiquora/trip/travel-profile";
import type { TripPlan, TripPlanItem } from "@raiquora/trip/trip-plan";
import { validateTrip, type Trip } from "@raiquora/trip/trip";
import type { ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import type { TripRequest } from "@raiquora/trip/trip-request";
import type { PlanningState, LifecycleState } from "@raiquora/trip/trip-state";

export interface AgentContextSnapshot {
  travelCandidates?: Record<string, unknown>[];
  realtimeFacts?: Record<string, unknown>[];
  profile?: {
    home?: { station?: string; area?: string; carAvailable: boolean };
    companions: string[];
    childAgeGroups: string[];
    favoriteInterests: string[];
    pace: "relaxed" | "balanced" | "active";
    typicalTravelMinutes?: number;
    avoidances: string[];
  };
  trip?: {
    /** V2 projections only; neither a repository nor writable AgentDecision state. */
    request?: TripRequest;
    planningState?: PlanningState;
    lifecycleState?: LifecycleState;
    scheduleTruncated?: boolean;
    title: string;
    destination: string;
    adults?: number;
    children?: number;
    considerations: string[];
    schedule: AgentTripScheduleItem[];
  };
}

export interface AgentTripScheduleItem {
  /** Stable V2 reference for item-scoped constraints and assumption effects; absent for legacy. */
  itemId?: string;
  /** V2 preserves precision/flexibility; absent for legacy items, never inferred as fixed. */
  schedule?: ItinerarySchedule;
  type: TripPlanItem["type"] | "transport" | "activity";
  category?: import("@raiquora/trip/trip").ActivityCategory;
  placeName?: string;
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
  trip?: TripPlan | Trip,
): AgentContextSnapshot {
  return {
    ...(profile ? { profile: profileSnapshot(profile) } : {}),
    ...(trip ? "schemaVersion" in trip ? { trip: selectedTripSnapshot(trip) }
      : { trip: tripSnapshot(trip), ...legacyCandidateSnapshot(trip) } : {}),
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
    carAvailable: homeProfile?.carAvailable === true,
  };
  const pace = travelStyle?.pace;
  const maximumTravelMinutes = partial.transport?.maxTypicalTravelMinutes;
  return {
    ...(home.station || home.area || home.carAvailable ? { home } : {}),
    companions: partial.companions?.usual?.slice(0, 5).map((value) => companionLabels[value] ?? value) ?? [],
    childAgeGroups: partial.companions?.children?.slice(0, 6)
      .map(({ ageGroup }) => childAgeLabels[ageGroup] ?? ageGroup) ?? [],
    favoriteInterests,
    pace: pace !== undefined && pace <= 0.35
      ? "relaxed"
      : pace !== undefined && pace >= 0.7 ? "active" : "balanced",
    ...(maximumTravelMinutes === null || maximumTravelMinutes === undefined
      ? {}
      : { typicalTravelMinutes: Math.max(0, Math.min(1_440, Math.round(maximumTravelMinutes))) }),
    avoidances: avoidances.filter(([tolerance]) => tolerance !== undefined && tolerance <= 0.35)
      .map(([, label]) => label),
  };
}

function tripSnapshot(trip: TripPlan): NonNullable<AgentContextSnapshot["trip"]> {
  return {
    title: bounded(trip.title, 100) ?? "現在の旅程",
    destination: bounded(trip.destination, 100) ?? "未設定",
    ...(trip.conditions ? {
      adults: Math.max(0, Math.min(20, Math.round(trip.conditions.adults))),
      children: Math.max(0, Math.min(20, Math.round(trip.conditions.children))),
    } : {}),
    considerations: trip.conditions?.considerations.flatMap((value) => {
      const text = bounded(value, 100);
      return text ? [text] : [];
    }).slice(0, 8) ?? [],
    schedule: trip.items.slice(0, 24).map(scheduleItem),
  };
}

function scheduleItem(item: TripPlanItem): AgentTripScheduleItem {
  if (item.type === "sightseeing") {
    return { type: item.type, summary: bounded(item.place.name, 100) ?? "観光", date: item.date };
  }
  if (item.type === "stay") {
    return {
      type: item.type,
      summary: bounded(item.accommodation?.name ?? item.destination, 100) ?? "宿泊",
      date: `${item.checkInDate}〜${item.checkOutDate}`,
    };
  }
  if (item.mode !== "rail") {
    return {
      type: item.type,
      summary: `${bounded(item.origin, 80) ?? "出発地"}→${bounded(item.destination, 80) ?? "到着地"}（${item.mode}）`,
      date: item.date,
    };
  }
  return {
    type: item.type,
    selectionStatus: "unresolved",
    ...(item.route.originIsProvisional ? { originIsProvisional: true } : {}),
    summary: `${bounded(item.route.originStation, 80) ?? "出発駅"}→${bounded(item.route.destinationStation, 80) ?? "到着駅"}（鉄道・経路未採用）`,
    date: item.route.departureDate,
  };
}

function legacyCandidateSnapshot(trip: TripPlan): Pick<AgentContextSnapshot, "travelCandidates" | "realtimeFacts"> {
  const travelCandidates: Record<string, unknown>[] = [];
  const realtimeFacts: Record<string, unknown>[] = [];
  trip.items.slice(0, 24).forEach((item, index) => {
    const itemRef = `legacy-item-${index + 1}`;
    if (item.type === "movement" && item.mode === "rail") {
      item.route.journeys.slice(0, 3).forEach((journey, candidateIndex) => {
        const candidateRef = `${itemRef}-route-${candidateIndex + 1}`;
        travelCandidates.push({ itemRef, candidateRef, kind: "rail", selectionStatus: "not-adopted",
          originStation: bounded(item.route.originStation, 80), destinationStation: bounded(item.route.destinationStation, 80),
          serviceDate: item.route.serviceDate, transferCount: journey.transferCount,
          // Legacy aggregate times can be realtime-adjusted: never project them as planned schedule.
          scheduledDepartureTimeMinutes: journey.legs[0]?.scheduledDepartureTimeMinutes,
          scheduledArrivalTimeMinutes: journey.legs.at(-1)?.scheduledArrivalTimeMinutes });
        realtimeFacts.push({ candidateRef, kind: "search-time-estimate", freshness: "unknown",
          departureTimeMinutes: journey.departureTimeMinutes, arrivalTimeMinutes: journey.arrivalTimeMinutes });
      });
    } else if (item.type === "stay") {
      item.options?.slice(0, 5).forEach((option, candidateIndex) => travelCandidates.push({
        itemRef, candidateRef: `${itemRef}-stay-${candidateIndex + 1}`, kind: "stay",
        name: bounded(option.name, 100), checkInDate: option.checkInDate, checkOutDate: option.checkOutDate,
      }));
    }
  });
  return { travelCandidates, realtimeFacts };
}

function selectedTripSnapshot(trip: Trip): NonNullable<AgentContextSnapshot["trip"]> {
  validateTrip(trip);
  return { title: bounded(trip.title, 100) ?? "現在の旅程", destination: "未設定", considerations: [],
    request: structuredClone(trip.request),
    planningState: trip.planningState, lifecycleState: trip.lifecycleState,
    scheduleTruncated: trip.items.length > 24,
    schedule: trip.items.slice(0, 24).map((item) => {
      const schedule = structuredClone(item.schedule);
      if (item.type === "activity") return { itemId: item.id, type: "activity", schedule,
        category: item.category, summary: bounded(item.title, 100)!,
        ...(item.place ? { placeName: bounded(item.place.name, 100) } : {}) };
      if (item.type === "stay") return { itemId: item.id, type: "stay", schedule, selectionStatus: item.selection.status,
        summary: bounded(item.selection.status === "selected" ? item.selection.accommodation.place.name : item.title, 100) ?? "宿泊" };
      if (item.detail.status === "unresolved") return { itemId: item.id, type: "transport", schedule, mode: item.detail.mode, summary: bounded(item.title, 100) ?? "移動", selectionStatus: "unresolved" };
      if (item.detail.mode !== "rail") return { itemId: item.id, type: "transport", schedule, mode: item.detail.mode,
        origin: item.detail.origin.name, destination: item.detail.destination.name, provenanceType: item.detail.provenance.type,
        selectionStatus: "selected", summary: bounded(item.title, 100) ?? "移動" };
      const journey = item.detail.journey;
      return { itemId: item.id, type: "transport", schedule, selectionStatus: "selected", mode: "rail", provenanceType: "verified_timetable",
        origin: journey.legs[0]!.origin.name, destination: journey.legs.at(-1)!.destination.name,
        summary: `${bounded(journey.legs[0]!.origin.name, 80)}→${bounded(journey.legs.at(-1)!.destination.name, 80)}（計画 ${journey.legs[0]!.scheduledDeparture.at} → ${journey.legs.at(-1)!.scheduledArrival.at}）`,
        date: journey.serviceDate };
    }) };
}

function bounded(value: string | undefined, maximum: number): string | undefined {
  const normalized = value?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maximum) : undefined;
}
