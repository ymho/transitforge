import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { FlightSearchResult } from "@raiquora/trip/flight-search";
import type { PlaceMediaSearchResult } from "@raiquora/trip/place-media";
import type { TravelRecheckKind, TravelRecheckRequest } from "@raiquora/trip/travel-recheck";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import type { WeatherForecast } from "@raiquora/trip/weather-forecast";
import type { Evidence } from "./evidence-model";
import type { AgentToolInputSchema } from "./tool-contract";

export const externalTravelToolNames = [
  "search_weather_forecast",
  "search_place_media",
  "search_flights",
  "schedule_trip_recheck",
] as const;

export type ExternalTravelToolName = typeof externalTravelToolNames[number];

export interface ExternalTravelToolState {
  weather?: ExternalTravelInformation<WeatherForecast>;
  places?: ExternalTravelInformation<PlaceMediaSearchResult>;
  flights?: ExternalTravelInformation<FlightSearchResult>;
}

export interface ExternalTravelToolDependencies {
  searchWeatherForecast?: (request: {
    location: string;
    startDate?: string;
    endDate?: string;
  }) => Promise<unknown>;
  searchPlaceMedia?: (request: {
    query: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    limit?: number;
  }) => Promise<unknown>;
  searchFlights?: (request: {
    originAirportCode: string;
    destinationAirportCode: string;
    departureDate: string;
    adults?: number;
    nonStop?: boolean;
    limit?: number;
  }) => Promise<unknown>;
  scheduleTravelRecheck?: (request: TravelRecheckRequest) => void;
  getTripPlan?: () => TripPlan | undefined;
}

export function isExternalTravelToolName(value: string): value is ExternalTravelToolName {
  return (externalTravelToolNames as readonly string[]).includes(value);
}

export function hasExternalTravelInformation(state: ExternalTravelToolState): boolean {
  return Boolean(state.weather || state.places || state.flights);
}

export function externalTravelToolDescription(name: ExternalTravelToolName): string {
  return {
    search_weather_forecast: "目的地の時間別と週間天気予報をEvidence付きで検索します。Viewerの演出だけを変えるset_weatherとは別です",
    search_place_media: "観光地と写真を出典 利用条件 座標付きで検索します。未確認の地点を推測して作りません",
    search_flights: "空港コード 日付 直行便条件で航空便候補をEvidence付きで検索します。価格や販売可否がない場合は不明のまま返します。日本側空港への移動はsearch_direct_routesで別に検証します",
    schedule_trip_recheck: "利用者が明示的に依頼した場合だけ 現在の旅程の天気 運行 航空便 営業情報を指定日時に再確認する予定を端末へ保存します",
  }[name];
}

export function externalTravelToolInputSchema(name: ExternalTravelToolName): AgentToolInputSchema {
  if (name === "search_weather_forecast") {
    return {
      type: "object",
      properties: {
        location: { type: "string", description: "天気を確認する都市 地域 観光地" },
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
      required: ["location"],
      additionalProperties: false,
    };
  }
  if (name === "search_place_media") {
    return {
      type: "object",
      properties: {
        query: { type: "string", description: "観光地 店舗 エリアの検索語" },
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        radiusMeters: { type: "integer", minimum: 100, maximum: 10_000 },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    };
  }
  if (name === "search_flights") {
    return {
      type: "object",
      properties: {
        originAirportCode: { type: "string", pattern: "^[A-Za-z]{3}$" },
        destinationAirportCode: { type: "string", pattern: "^[A-Za-z]{3}$" },
        departureDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        adults: { type: "integer", minimum: 1, maximum: 9 },
        nonStop: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["originAirportCode", "destinationAirportCode", "departureDate"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["weather", "rail-operation", "flight", "place-hours"] },
      entityId: { type: "string" },
      scheduledAt: { type: "string", description: "ISO 8601日時" },
      timeZone: { type: "string" },
    },
    required: ["kind", "entityId", "scheduledAt", "timeZone"],
    additionalProperties: false,
  };
}

export async function executeExternalTravelTool(
  name: ExternalTravelToolName,
  input: Record<string, unknown>,
  dependencies: ExternalTravelToolDependencies,
  state: ExternalTravelToolState,
): Promise<unknown> {
  if (name === "search_weather_forecast") {
    const location = text(input.location);
    const startDate = optionalDate(input.startDate);
    const endDate = optionalDate(input.endDate);
    if (!location || !dependencies.searchWeatherForecast || input.startDate !== undefined && !startDate || input.endDate !== undefined && !endDate) {
      throw new Error("天気予報の検索条件が不正です。");
    }
    const output = await dependencies.searchWeatherForecast({ location, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) });
    if (isRecord(output) && isRecord(output.forecast)) state.weather = output.forecast as unknown as ExternalTravelInformation<WeatherForecast>;
    return output;
  }
  if (name === "search_place_media") {
    const query = text(input.query);
    const latitude = finiteNumber(input.latitude);
    const longitude = finiteNumber(input.longitude);
    const radiusMeters = finiteNumber(input.radiusMeters);
    const limit = finiteNumber(input.limit);
    if (!query || !dependencies.searchPlaceMedia || (latitude === undefined) !== (longitude === undefined)) {
      throw new Error("観光地の検索条件が不正です。");
    }
    const output = await dependencies.searchPlaceMedia({ query, ...(latitude === undefined ? {} : { latitude, longitude }), ...(radiusMeters === undefined ? {} : { radiusMeters }), ...(limit === undefined ? {} : { limit }) });
    if (isRecord(output) && isRecord(output.result)) state.places = output.result as unknown as ExternalTravelInformation<PlaceMediaSearchResult>;
    return output;
  }
  if (name === "search_flights") {
    const originAirportCode = text(input.originAirportCode).toUpperCase();
    const destinationAirportCode = text(input.destinationAirportCode).toUpperCase();
    const departureDate = optionalDate(input.departureDate);
    if (!dependencies.searchFlights || !/^[A-Z]{3}$/u.test(originAirportCode) || !/^[A-Z]{3}$/u.test(destinationAirportCode) || !departureDate) {
      throw new Error("航空便の検索条件が不正です。");
    }
    const adults = finiteNumber(input.adults);
    const limit = finiteNumber(input.limit);
    const output = await dependencies.searchFlights({ originAirportCode, destinationAirportCode, departureDate, ...(adults === undefined ? {} : { adults }), ...(typeof input.nonStop === "boolean" ? { nonStop: input.nonStop } : {}), ...(limit === undefined ? {} : { limit }) });
    if (isRecord(output) && isRecord(output.flights)) state.flights = output.flights as unknown as ExternalTravelInformation<FlightSearchResult>;
    return output;
  }
  const plan = dependencies.getTripPlan?.();
  const kinds: TravelRecheckKind[] = ["weather", "rail-operation", "flight", "place-hours"];
  const kind = typeof input.kind === "string" && kinds.includes(input.kind as TravelRecheckKind) ? input.kind as TravelRecheckKind : undefined;
  const entityId = text(input.entityId).slice(0, 120);
  const scheduledAt = typeof input.scheduledAt === "string" && Number.isFinite(Date.parse(input.scheduledAt)) ? input.scheduledAt : undefined;
  const timeZone = text(input.timeZone).slice(0, 80);
  if (!plan || !kind || !entityId || !scheduledAt || !timeZone || !dependencies.scheduleTravelRecheck) {
    throw new Error("再確認の予定を保存できません。");
  }
  const now = new Date().toISOString();
  dependencies.scheduleTravelRecheck({
    id: `recheck-${crypto.randomUUID()}`,
    tripPlanId: plan.id,
    kind,
    entityId,
    scheduledAt,
    timeZone,
    createdAt: now,
    expiresAt: new Date(Date.parse(scheduledAt) + 24 * 60 * 60_000).toISOString(),
  });
  return { scheduled: true, kind, entityId, scheduledAt, timeZone };
}

export function externalTravelEvidence(output: unknown, context: { retrievedAt: string }): Evidence[] {
  if (!isRecord(output)) return [];
  const information = isRecord(output.forecast) ? output.forecast : isRecord(output.result) ? output.result : isRecord(output.flights) ? output.flights : undefined;
  if (!information || !Array.isArray(information.evidence)) return [];
  return information.evidence.slice(0, 8).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.provider !== "string") return [];
    return [{
      id: raw.id,
      category: "external" as const,
      knowledgeKind: "deterministic_fact" as const,
      subject: isRecord(information.data) && typeof information.data.locationName === "string" ? `${information.data.locationName}の天気予報` : "外部旅行情報",
      facts: { provider: raw.provider, status: String(information.status ?? "unknown"), freshness: String(information.freshness ?? "unknown") },
      references: [{
        sourceType: "external-source" as const,
        sourceRef: typeof raw.sourceUrl === "string" ? raw.sourceUrl : raw.id,
        retrievedAt: typeof raw.retrievedAt === "string" ? raw.retrievedAt : context.retrievedAt,
        freshness: information.freshness === "fresh" ? "current" as const : "unknown" as const,
        summary: typeof raw.attribution === "string" ? raw.attribution : `${raw.provider}から取得`,
      }],
    }];
  });
}

function optionalDate(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
