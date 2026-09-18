import type { AccommodationProvider } from "../ports/travel-provider.js";
import { failure, parseProviderRequest, parseProviderResponse, ProviderBoundaryError, type FixedEgressResponse } from "./fixed-egress-provider-contract.js";

/** IAM Invoke entry. Never serialize exceptions or log event/provider data. */
export function createFixedEgressProviderHandler(provider: AccommodationProvider) {
  return async (event: unknown): Promise<FixedEgressResponse> => {
    try {
      const { request, requestId } = parseProviderRequest(event);
      return parseProviderResponse({ ok: true, accommodations: await provider.search(request, requestId) }, request);
    } catch (error) {
      // Existing HTTP adapter wraps failures. Only known bounded codes may cross this boundary.
      const normalized = error instanceof ProviderBoundaryError ? error
        : error instanceof Error && error.cause instanceof ProviderBoundaryError ? error.cause : undefined;
      return failure(normalized?.code ?? "unavailable");
    }
  };
}
