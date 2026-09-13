import { parseHazardAlertQuery, validateHazardAlertInformation, type HazardAlertQuery } from "@raiquora/trip/hazard-alert";
import { failedExternalInformation } from "@raiquora/trip/external-travel-information";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { HazardAlertProvider } from "../ports/hazard-alert-provider.js";

export function createHazardAlertSearchOperation(provider: HazardAlertProvider): AgentOperation {
  return async (request) => {
    let query: HazardAlertQuery;
    try {
      const { operation, ...input } = request;
      if (operation !== undefined && operation !== "travel_alert_search") throw new Error("Invalid operation");
      query = parseHazardAlertQuery(input);
    } catch {
      return { statusCode: 400, body: { message: "防災情報の検索条件が不正です" } };
    }
    let result: unknown;
    try { result = await provider.search(query); }
    catch { return { body: { alerts: failedExternalInformation({ code: "unavailable", message: "防災情報を取得できません", retryable: true }) } }; }
    try {
      validateHazardAlertInformation(result);
      if (result.data && (result.data.area !== query.area || result.data.alerts.length > (query.limit ?? 8) ||
          query.categories?.length && result.data.alerts.some((alert) => !query.categories!.includes(alert.category)))) throw new Error("Mismatched hazard scope");
      return { body: { alerts: result } };
    } catch {
      return { body: { alerts: failedExternalInformation({ code: "invalid_response", message: "防災情報の応答を確認できません", retryable: false }) } };
    }
  };
}
