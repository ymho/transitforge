import { ProviderBoundaryError } from "../ports/provider-boundary-error.js";
import { providerSearchFrom } from "../contracts/accommodation-search.js";
export { providerSearchFrom } from "../contracts/accommodation-search.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { AccommodationProvider } from "../ports/travel-provider.js";

export function createAccommodationSearchOperation(provider: AccommodationProvider): AgentOperation {
  return async (request, context) => {
    try { return { body: { accommodations: await provider.search(providerSearchFrom(request), context.requestId) } }; }
    catch (error) {
      if (!(error instanceof ProviderBoundaryError)) throw error;
      return { statusCode: error.retryable ? 503 : 422, body: { error: { code: error.code, retryable: error.retryable } } };
    }
  };
}
