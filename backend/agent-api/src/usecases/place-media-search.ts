import type { PlaceMediaProvider } from "../ports/place-media-provider.js";
import type { AgentOperation } from "../ports/agent-operation.js";

export function createPlaceMediaSearchOperation(provider: PlaceMediaProvider): AgentOperation {
  return async (request) => {
    const query = typeof request.query === "string" ? request.query.trim() : "";
    const latitude = finite(request.latitude);
    const longitude = finite(request.longitude);
    if (!query || query.length > 100 || (latitude === undefined) !== (longitude === undefined)) return { statusCode: 400, body: { message: "観光地の検索条件が不正です" } };
    const result = await provider.search({ query, ...(latitude === undefined ? {} : { latitude, longitude }), ...(finite(request.radiusMeters) ? { radiusMeters: request.radiusMeters as number } : {}), ...(finite(request.limit) ? { limit: request.limit as number } : {}), ...(request.detail === true ? { detail: true } : {}) });
    return { body: { result } };
  };
}

function finite(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
