import type { TravelAlertCategory } from "@raiquora/trip/travel-alert";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { TravelAlertProvider } from "../ports/travel-alert-provider.js";

const categories: TravelAlertCategory[] = ["warning", "weather-information", "typhoon", "earthquake", "tsunami", "volcano", "other"];

export function createTravelAlertSearchOperation(provider: TravelAlertProvider): AgentOperation {
  return async (request) => {
    const area = typeof request.area === "string" ? request.area.normalize("NFKC").trim() : "";
    const requestedCategories = Array.isArray(request.categories)
      ? request.categories.filter((item): item is TravelAlertCategory => typeof item === "string" && categories.includes(item as TravelAlertCategory)).slice(0, 7)
      : undefined;
    const limit = typeof request.limit === "number" && Number.isInteger(request.limit) ? request.limit : undefined;
    if (!area || area.length > 80 || limit !== undefined && (limit < 1 || limit > 12)) {
      return { statusCode: 400, body: { message: "防災情報の検索条件が不正です" } };
    }
    const alerts = await provider.search({ area, ...(requestedCategories?.length ? { categories: requestedCategories } : {}), ...(limit ? { limit } : {}) });
    return { body: { alerts } };
  };
}
