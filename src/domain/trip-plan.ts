import type {
  ViewerAgentAccommodation,
  ViewerAgentJourneyPlan,
  ViewerAgentTravelPlan,
} from "./viewer-agent-response";

export const tripPlanStorageKey = "transitforge.trip-plan.v1";

interface TripPlanItemBase {
  id: string;
  type: "movement" | "stay" | "sightseeing";
}

export type MovementMode = "rail" | "rental-car" | "car" | "bus" | "walk" | "other";
export type MovementPlanItem = RailMovementPlanItem | ManualMovementPlanItem;
export interface RailMovementPlanItem extends TripPlanItemBase {
  type: "movement";
  mode: "rail";
  route: ViewerAgentJourneyPlan;
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
  accommodation?: ViewerAgentAccommodation;
  options?: ViewerAgentAccommodation[];
  checkInDate: string;
  checkOutDate: string;
  destination: string;
}
export interface SightseeingPlanItem extends TripPlanItemBase {
  type: "sightseeing";
  place: {
    name: string;
    provider: "manual" | "mapbox";
    placeId?: string;
    coordinate?: [number, number];
  };
  date?: string;
}
export type TripPlanItem = MovementPlanItem | StayPlanItem | SightseeingPlanItem;
export interface TripPlan {
  version: 1;
  id: string;
  title: string;
  destination: string;
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
  | { type: "metadata"; title?: string; destination?: string };

export function applyTripPlanPatches(
  plan: TripPlan,
  patches: TripPlanPatch[],
  now = new Date(),
): TripPlan {
  let items = [...plan.items];
  let title = plan.title;
  let destination = plan.destination;
  for (const patch of patches) {
    if (patch.type === "add" && !items.some((item) => item.id === patch.item.id)) {
      const afterIndex = patch.afterId
        ? items.findIndex((item) => item.id === patch.afterId)
        : -1;
      const index = afterIndex >= 0 ? afterIndex + 1 : items.length;
      items.splice(index, 0, patch.item);
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
        const target = afterIndex >= 0 ? afterIndex + 1 : items.length;
        items.splice(target, 0, item);
      }
    }
    if (patch.type === "metadata") {
      title = patch.title ?? title;
      destination = patch.destination ?? destination;
    }
  }
  return { ...plan, title, destination, items, updatedAt: now.toISOString() };
}

export function tripPlanFromTravelPlan(
  value: ViewerAgentTravelPlan,
  now = new Date(),
): TripPlan {
  return {
    version: 1,
    id: `trip-${crypto.randomUUID()}`,
    title: titleForTravelPlan(value),
    destination: value.destination,
    items: [
      { id: "outbound", type: "movement", mode: "rail", route: value.outbound },
      {
        id: "stay",
        type: "stay",
        destination: value.destination,
        checkInDate: value.checkInDate,
        checkOutDate: value.checkOutDate,
        options: value.accommodations,
      },
      { id: "return", type: "movement", mode: "rail", route: value.returning },
    ],
    updatedAt: now.toISOString(),
  };
}

export function tripPlanPatchesFromTravelPlan(
  value: ViewerAgentTravelPlan,
): TripPlanPatch[] {
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
    {
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
    },
    {
      type: "replace",
      itemId: "return",
      item: { id: "return", type: "movement", mode: "rail", route: value.returning },
    },
  ];
}

export function loadTripPlan(storage: Pick<Storage, "getItem">): TripPlan | undefined {
  try {
    const raw = storage.getItem(tripPlanStorageKey);
    return raw ? parseTripPlan(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export function saveTripPlan(storage: Pick<Storage, "setItem">, plan: TripPlan): void {
  storage.setItem(tripPlanStorageKey, JSON.stringify(plan));
}

export function selectTripPlanAccommodation(
  plan: TripPlan,
  accommodation: ViewerAgentAccommodation,
  now = new Date(),
): TripPlan {
  return {
    ...plan,
    updatedAt: now.toISOString(),
    items: plan.items.map((item) =>
      item.type === "stay" ? { ...item, accommodation } : item),
  };
}

function parseTripPlan(value: unknown): TripPlan | undefined {
  if (!isRecord(value) || value.version !== 1 || !isBoundedString(value.id, 100) ||
    !isBoundedString(value.title, 100) || !isBoundedString(value.destination, 100) ||
    typeof value.updatedAt !== "string" || !Array.isArray(value.items)) {
    return undefined;
  }
  const items = value.items.filter(isTripPlanItem).slice(0, 100);
  if (items.length !== value.items.length || new Set(items.map((item) => item.id)).size !== items.length) {
    return undefined;
  }
  return {
    version: 1,
    id: value.id,
    title: value.title,
    destination: value.destination,
    updatedAt: value.updatedAt,
    items,
  };
}

function titleForTravelPlan(value: ViewerAgentTravelPlan): string {
  const themes = ["ゆったり巡る旅", "季節を味わう小旅行", "寄り道を楽しむ旅", "心ほどける滞在"];
  const key = [...`${value.destination}${value.checkInDate}${value.checkOutDate}`]
    .reduce((total, character) => total + character.charCodeAt(0), 0);
  return `${value.destination}を${themes[key % themes.length]}`;
}

function isTripPlanItem(value: unknown): value is TripPlanItem {
  if (!isRecord(value) || !isBoundedString(value.id, 100)) return false;
  if (value.type === "movement") {
    // mode導入前に保存した鉄道移動も読み込めるようにする。
    if ((value.mode === undefined || value.mode === "rail") && isJourneyPlan(value.route)) {
      value.mode = "rail";
      return true;
    }
    return isManualMovementMode(value.mode) && isBoundedString(value.origin, 100) &&
      isBoundedString(value.destination, 100) &&
      (value.date === undefined || isDateString(value.date)) &&
      optionalBoundedString(value.note, 500);
  }
  if (value.type === "stay") {
    return isBoundedString(value.destination, 100) && isDateString(value.checkInDate) &&
      isDateString(value.checkOutDate) &&
      (value.accommodation === undefined || isAccommodation(value.accommodation)) &&
      (value.options === undefined || Array.isArray(value.options) &&
        value.options.length <= 20 && value.options.every(isAccommodation));
  }
  if (value.type === "sightseeing") {
    return isRecord(value.place) && isBoundedString(value.place.name, 100) &&
      (value.place.provider === "manual" || value.place.provider === "mapbox") &&
      (value.place.placeId === undefined || isBoundedString(value.place.placeId, 200)) &&
      (value.place.coordinate === undefined || isCoordinate(value.place.coordinate)) &&
      (value.date === undefined || isDateString(value.date));
  }
  return false;
}

function isJourneyPlan(value: unknown): value is ViewerAgentJourneyPlan {
  return isRecord(value) && isBoundedString(value.originStation, 100) &&
    isBoundedString(value.destinationStation, 100) && Array.isArray(value.journeys);
}

function isManualMovementMode(value: unknown): value is ManualMovementPlanItem["mode"] {
  return value === "rental-car" || value === "car" || value === "bus" ||
    value === "walk" || value === "other";
}

function isAccommodation(value: unknown): value is ViewerAgentAccommodation {
  return isRecord(value) && isBoundedString(value.name, 200) &&
    isDateString(value.checkInDate) && isDateString(value.checkOutDate) &&
    optionalBoundedString(value.bookingUrl, 2_000) &&
    optionalBoundedString(value.areaName, 200) &&
    optionalBoundedString(value.imageUrl, 2_000);
}

function isCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function optionalBoundedString(value: unknown, maximum: number): boolean {
  return value === undefined || isBoundedString(value, maximum);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
