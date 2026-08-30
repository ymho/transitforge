import type { UserProfile } from "@raiquora/trip/travel-profile";
import { travelPreferenceLabels } from "@raiquora/trip/travel-profile";
import type { TripPlan, TripPlanItem } from "@raiquora/trip/trip-plan";

export interface AgentContextSnapshot {
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
    title: string;
    destination: string;
    adults?: number;
    children?: number;
    considerations: string[];
    schedule: AgentTripScheduleItem[];
  };
}

export interface AgentTripScheduleItem {
  type: TripPlanItem["type"];
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
  trip?: TripPlan,
): AgentContextSnapshot {
  return {
    ...(profile ? { profile: profileSnapshot(profile) } : {}),
    ...(trip ? { trip: tripSnapshot(trip) } : {}),
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
  const journey = item.route.journeys[0];
  return {
    type: item.type,
    summary: `${bounded(item.route.originStation, 80) ?? "出発駅"}→${bounded(item.route.destinationStation, 80) ?? "到着駅"}（鉄道${journey ? ` 乗換${journey.transferCount}回` : ""}）`,
    date: item.route.departureDate,
    ...(journey ? {
      departureTimeMinutes: journey.departureTimeMinutes,
      arrivalTimeMinutes: journey.arrivalTimeMinutes,
    } : {}),
  };
}

function bounded(value: string | undefined, maximum: number): string | undefined {
  const normalized = value?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maximum) : undefined;
}
