import type { AgentOperation } from "../ports/agent-operation.js";
import type { RestaurantProvider } from "../ports/restaurant-provider.js";
import type { RestaurantRequirements } from "@raiquora/trip/restaurant-search";

export function createRestaurantSearchOperation(provider: RestaurantProvider): AgentOperation {
  return async (request) => {
    const area = typeof request.area === "string" ? request.area.normalize("NFKC").trim() : "";
    const keyword = typeof request.keyword === "string" ? request.keyword.normalize("NFKC").trim() : undefined;
    const latitude = finite(request.latitude); const longitude = finite(request.longitude);
    const range = typeof request.range === "number" && [1, 2, 3, 4, 5].includes(request.range) ? request.range as 1 | 2 | 3 | 4 | 5 : undefined;
    const requirements = validatedRequirements(request.requirements);
    const limit = typeof request.limit === "number" && Number.isInteger(request.limit) ? request.limit : undefined;
    if (!area || area.length > 100 || (latitude === undefined) !== (longitude === undefined) || limit !== undefined && (limit < 1 || limit > 10)) return { statusCode: 400, body: { message: "飲食店検索の条件が不正です" } };
    const restaurants = await provider.search({ area, ...(keyword ? { keyword: keyword.slice(0, 100) } : {}), ...(latitude === undefined ? {} : { latitude, longitude }), ...(range ? { range } : {}), ...(requirements ? { requirements } : {}), ...(limit ? { limit } : {}) });
    return { body: { restaurants } };
  };
}
function finite(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function validatedRequirements(value: unknown): RestaurantRequirements | undefined {
  if (!isRecord(value)) return undefined;
  const keys = ["lunch", "lateNight", "childFriendly", "nonSmoking", "barrierFree", "parking", "privateRoom", "cardAccepted"] as const;
  const entries = keys.flatMap((key) => value[key] === true ? [[key, true] as const] : []);
  return entries.length > 0 ? Object.fromEntries(entries) as RestaurantRequirements : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
