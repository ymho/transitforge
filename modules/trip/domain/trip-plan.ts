import type {
  TravelPlan,
  TripAccommodation,
  TripJourneyPlan,
} from "./travel-plan";

interface TripPlanItemBase {
  id: string;
  type: "movement" | "stay" | "sightseeing";
}

export type MovementMode =
  | "rail"
  | "rental-car"
  | "car"
  | "bus"
  | "walk"
  | "other";
export type MovementPlanItem = RailMovementPlanItem | ManualMovementPlanItem;
export interface RailMovementPlanItem extends TripPlanItemBase {
  type: "movement";
  mode: "rail";
  route: TripJourneyPlan;
}
export interface ManualMovementPlanItem extends TripPlanItemBase {
  type: "movement";
  mode: Exclude<MovementMode, "rail">;
  origin: string;
  destination: string;
  date?: string;
  note?: string;
}
export interface StayPlanItem extends TripPlanItemBase {
  type: "stay";
  accommodation?: TripAccommodation;
  options?: TripAccommodation[];
  checkInDate: string;
  checkOutDate: string;
  destination: string;
}
export interface SightseeingPlanItem extends TripPlanItemBase {
  type: "sightseeing";
  place: {
    name: string;
    provider: "manual" | "mapbox" | "wikipedia";
    placeId?: string;
    coordinate?: [number, number];
  };
  date?: string;
}
export type TripPlanItem = MovementPlanItem | StayPlanItem | SightseeingPlanItem;
export interface TripPlanConditions {
  adults: number;
  children: number;
  considerations: string[];
}
export interface TripPlan {
  version: 1;
  id: string;
  title: string;
  destination: string;
  conditions?: TripPlanConditions;
  items: TripPlanItem[];
  updatedAt: string;
}
export interface TripPlanUpdateProposal {
  summary: string;
  patches: TripPlanPatch[];
}
export type TripPlanPatch =
  | { type: "add"; item: TripPlanItem; afterId?: string }
  | { type: "replace"; itemId: string; item: TripPlanItem }
  | { type: "remove"; itemId: string }
  | { type: "move"; itemId: string; afterId?: string }
  | {
      type: "metadata";
      title?: string;
      destination?: string;
      conditions?: TripPlanConditions;
    };

export function applyTripPlanPatches(
  plan: TripPlan,
  patches: TripPlanPatch[],
  now = new Date(),
): TripPlan {
  let items = [...plan.items];
  let title = plan.title;
  let destination = plan.destination;
  let conditions = plan.conditions;
  for (const patch of patches) {
    if (patch.type === "add" && !items.some((item) => item.id === patch.item.id)) {
      const afterIndex = patch.afterId
        ? items.findIndex((item) => item.id === patch.afterId)
        : -1;
      items.splice(afterIndex >= 0 ? afterIndex + 1 : items.length, 0, patch.item);
    }
    if (patch.type === "replace") {
      const index = items.findIndex((item) => item.id === patch.itemId);
      if (index >= 0) items[index] = { ...patch.item, id: patch.itemId };
      else items.push({ ...patch.item, id: patch.itemId });
    }
    if (patch.type === "remove") {
      items = items.filter((item) => item.id !== patch.itemId);
    }
    if (patch.type === "move" && patch.itemId !== patch.afterId) {
      const index = items.findIndex((item) => item.id === patch.itemId);
      if (index >= 0) {
        const [item] = items.splice(index, 1);
        const afterIndex = patch.afterId
          ? items.findIndex((candidate) => candidate.id === patch.afterId)
          : -1;
        items.splice(afterIndex >= 0 ? afterIndex + 1 : items.length, 0, item);
      }
    }
    if (patch.type === "metadata") {
      title = patch.title ?? title;
      destination = patch.destination ?? destination;
      conditions = patch.conditions ?? conditions;
    }
  }
  return {
    ...plan,
    title,
    destination,
    conditions,
    items,
    updatedAt: now.toISOString(),
  };
}

export function tripPlanFromTravelPlan(
  value: TravelPlan,
  now = new Date(),
  tripPlanId = deterministicTripPlanId(value, now),
): TripPlan {
  return {
    version: 1,
    id: tripPlanId,
    title: titleForTravelPlan(value),
    destination: value.destination,
    conditions: {
      adults: value.adults ?? 1,
      children: value.children ?? 0,
      considerations: value.considerations?.slice(0, 8) ?? [],
    },
    items: [
      { id: "outbound", type: "movement", mode: "rail", route: value.outbound },
      ...(value.dayTrip ? [] : [{
        id: "stay",
        type: "stay" as const,
        destination: value.destination,
        checkInDate: value.checkInDate,
        checkOutDate: value.checkOutDate,
        options: value.accommodations,
      }]),
      { id: "return", type: "movement", mode: "rail", route: value.returning },
    ],
    updatedAt: now.toISOString(),
  };
}

export function tripPlanPatchesFromTravelPlan(value: TravelPlan): TripPlanPatch[] {
  return [
    {
      type: "metadata",
      title: titleForTravelPlan(value),
      destination: value.destination,
    },
    {
      type: "replace",
      itemId: "outbound",
      item: { id: "outbound", type: "movement", mode: "rail", route: value.outbound },
    },
    ...(value.dayTrip ? [{
      type: "remove" as const,
      itemId: "stay",
    }] : [{
      type: "replace",
      itemId: "stay",
      item: {
        id: "stay",
        type: "stay",
        destination: value.destination,
        checkInDate: value.checkInDate,
        checkOutDate: value.checkOutDate,
        options: value.accommodations,
      },
    } as const]),
    {
      type: "replace",
      itemId: "return",
      item: { id: "return", type: "movement", mode: "rail", route: value.returning },
    },
  ];
}

export function selectTripPlanAccommodation(
  plan: TripPlan,
  accommodation: TripAccommodation,
  now = new Date(),
): TripPlan {
  return {
    ...plan,
    updatedAt: now.toISOString(),
    items: plan.items.map((item) =>
      item.type === "stay" ? { ...item, accommodation } : item
    ),
  };
}

function titleForTravelPlan(value: TravelPlan): string {
  const themes = [
    "ゆったり巡る旅",
    "季節を味わう小旅行",
    "寄り道を楽しむ旅",
    "心ほどける滞在",
  ];
  const key = [...`${value.destination}${value.checkInDate}${value.checkOutDate}`]
    .reduce((total, character) => total + character.charCodeAt(0), 0);
  return `${value.destination}を${themes[key % themes.length]}`;
}

function deterministicTripPlanId(value: TravelPlan, now: Date): string {
  const key = `${value.destination}\t${value.checkInDate}\t${value.checkOutDate}\t${now.toISOString()}`;
  let hash = 2_166_136_261;
  for (const character of key) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `trip-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
